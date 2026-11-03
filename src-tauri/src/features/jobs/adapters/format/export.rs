use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use dopedb_protocol::NormalizedTypeFamily;
use flate2::write::GzEncoder;
use flate2::Compression;
use rust_xlsxwriter::Workbook;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::features::jobs::JobFormat;

use super::io::open_output_file;
use super::values::{
    row_object, write_delimited_row, write_delimited_values, write_insert, write_xlsx_value,
    xlsx_error,
};
use super::XLSX_MAX_ROWS;

enum TextWriterInner {
    Plain(BufWriter<File>),
    Gzip(Box<GzEncoder<BufWriter<File>>>),
}

pub(in crate::features::jobs) struct TextWriter {
    inner: TextWriterInner,
    hasher: Sha256,
}

impl Write for TextWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let written = match &mut self.inner {
            TextWriterInner::Plain(writer) => writer.write(buf),
            TextWriterInner::Gzip(writer) => writer.write(buf),
        }?;
        self.hasher.update(&buf[..written]);
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match &mut self.inner {
            TextWriterInner::Plain(writer) => writer.flush(),
            TextWriterInner::Gzip(writer) => writer.flush(),
        }
    }
}

impl TextWriter {
    fn fingerprint(&self) -> String {
        hex::encode(self.hasher.clone().finalize())
    }

    fn finish(self) -> AppResult<()> {
        match self.inner {
            TextWriterInner::Plain(mut writer) => {
                writer.flush()?;
                writer.get_ref().sync_all()?;
            }
            TextWriterInner::Gzip(writer) => {
                let mut writer = (*writer).finish()?;
                writer.flush()?;
                writer.get_ref().sync_all()?;
            }
        }
        Ok(())
    }
}

pub(in crate::features::jobs) enum ExportSink {
    Text {
        writer: TextWriter,
        format: JobFormat,
        columns: Vec<String>,
        type_families: Vec<NormalizedTypeFamily>,
        table_sql: String,
        engine: crate::model::Engine,
        rows_written: u64,
    },
    Xlsx {
        workbook: Box<Workbook>,
        file: File,
        columns: Vec<String>,
        sheet_index: usize,
        row: u32,
        rows_written: u64,
    },
}

impl ExportSink {
    pub(in crate::features::jobs) fn open(
        path: &Path,
        format: JobFormat,
        columns: Vec<String>,
        type_families: Vec<NormalizedTypeFamily>,
        table_sql: String,
        engine: crate::model::Engine,
        resume_rows: u64,
    ) -> AppResult<Self> {
        if resume_rows > 0 && !format.resumable() {
            return Err(AppError::Blocked {
                reason: "this export format cannot resume; start a new job".into(),
            });
        }
        if format == JobFormat::Xlsx {
            if resume_rows > 0 {
                return Err(AppError::Blocked {
                    reason: "XLSX export cannot resume; start a new job".into(),
                });
            }
            let mut workbook = Workbook::new();
            workbook
                .add_worksheet_with_constant_memory()
                .map_err(xlsx_error)?;
            let file = open_output_file(path, false, false)?;
            let mut sink = Self::Xlsx {
                workbook: Box::new(workbook),
                file,
                columns,
                sheet_index: 0,
                row: 0,
                rows_written: 0,
            };
            sink.ensure_xlsx_header()?;
            return Ok(sink);
        }

        let append = resume_rows > 0 && format.resumable();
        let mut hasher = Sha256::new();
        let mut file = open_output_file(path, append, false)?;
        if append {
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let read = file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            file.seek(SeekFrom::End(0))?;
        }
        let buffered = BufWriter::new(file);
        let inner = if format.compressed() {
            if append {
                return Err(AppError::Blocked {
                    reason: "compressed exports cannot resume; start a new job".into(),
                });
            }
            TextWriterInner::Gzip(Box::new(GzEncoder::new(buffered, Compression::default())))
        } else {
            TextWriterInner::Plain(buffered)
        };
        let writer = TextWriter { inner, hasher };
        let mut sink = Self::Text {
            writer,
            format: format.base(),
            columns,
            type_families,
            table_sql,
            engine,
            rows_written: resume_rows,
        };
        sink.ensure_text_header()?;
        Ok(sink)
    }

    fn ensure_text_header(&mut self) -> AppResult<()> {
        let Self::Text {
            writer,
            format,
            columns,
            rows_written,
            ..
        } = self
        else {
            return Ok(());
        };
        if *rows_written > 0 {
            return Ok(());
        }
        match format {
            JobFormat::Csv => write_delimited_row(writer, columns, b',')?,
            JobFormat::Tsv => write_delimited_row(writer, columns, b'\t')?,
            JobFormat::Json => writer.write_all(b"[")?,
            JobFormat::Ndjson | JobFormat::Sql => {}
            _ => return Err(AppError::Config("unsupported text export format".into())),
        }
        Ok(())
    }

    fn ensure_xlsx_header(&mut self) -> AppResult<()> {
        let Self::Xlsx {
            workbook,
            columns,
            sheet_index,
            row,
            ..
        } = self
        else {
            return Ok(());
        };
        let worksheet = workbook
            .worksheet_from_index(*sheet_index)
            .map_err(xlsx_error)?;
        for (column, value) in columns.iter().enumerate() {
            worksheet
                .write_string(*row, column as u16, value)
                .map_err(xlsx_error)?;
        }
        *row += 1;
        Ok(())
    }

    pub(in crate::features::jobs) fn write_rows(&mut self, rows: &[Vec<Value>]) -> AppResult<()> {
        match self {
            Self::Text {
                writer,
                format,
                columns,
                type_families,
                table_sql,
                engine,
                rows_written,
            } => {
                for values in rows {
                    match format {
                        JobFormat::Csv => write_delimited_values(writer, values, b',')?,
                        JobFormat::Tsv => write_delimited_values(writer, values, b'\t')?,
                        JobFormat::Json => {
                            if *rows_written > 0 {
                                writer.write_all(b",")?;
                            }
                            serde_json::to_writer(&mut *writer, &row_object(columns, values))?;
                        }
                        JobFormat::Ndjson => {
                            serde_json::to_writer(&mut *writer, &row_object(columns, values))?;
                            writer.write_all(b"\n")?;
                        }
                        JobFormat::Sql => {
                            write_insert(
                                writer,
                                *engine,
                                table_sql,
                                columns,
                                type_families,
                                values,
                            )?;
                        }
                        _ => {
                            return Err(AppError::Config("unsupported export writer format".into()))
                        }
                    }
                    *rows_written += 1;
                }
                writer.flush()?;
            }
            Self::Xlsx {
                workbook,
                columns,
                sheet_index,
                row,
                rows_written,
                ..
            } => {
                for values in rows {
                    if *row >= XLSX_MAX_ROWS {
                        workbook
                            .add_worksheet_with_constant_memory()
                            .map_err(xlsx_error)?;
                        *sheet_index += 1;
                        *row = 0;
                        let worksheet = workbook
                            .worksheet_from_index(*sheet_index)
                            .map_err(xlsx_error)?;
                        for (column, value) in columns.iter().enumerate() {
                            worksheet
                                .write_string(*row, column as u16, value)
                                .map_err(xlsx_error)?;
                        }
                        *row += 1;
                    }
                    let worksheet = workbook
                        .worksheet_from_index(*sheet_index)
                        .map_err(xlsx_error)?;
                    for (column, value) in values.iter().enumerate() {
                        write_xlsx_value(worksheet, *row, column as u16, value)?;
                    }
                    *row += 1;
                    *rows_written += 1;
                }
            }
        }
        Ok(())
    }

    pub(in crate::features::jobs) fn rows_written(&self) -> u64 {
        match self {
            Self::Text { rows_written, .. } | Self::Xlsx { rows_written, .. } => *rows_written,
        }
    }

    pub(in crate::features::jobs) fn fingerprint(&self) -> Option<String> {
        match self {
            Self::Text { writer, .. } => Some(writer.fingerprint()),
            Self::Xlsx { .. } => None,
        }
    }

    pub(in crate::features::jobs) fn flush(&mut self) -> AppResult<()> {
        if let Self::Text { writer, .. } = self {
            writer.flush()?;
        }
        Ok(())
    }

    pub(in crate::features::jobs) fn finish(mut self) -> AppResult<()> {
        match &mut self {
            Self::Text {
                writer,
                format: JobFormat::Json,
                ..
            } => writer.write_all(b"]")?,
            Self::Text { .. } | Self::Xlsx { .. } => {}
        }
        match self {
            Self::Text { writer, .. } => writer.finish(),
            Self::Xlsx {
                mut workbook,
                mut file,
                ..
            } => {
                workbook.save_to_writer(&mut file).map_err(xlsx_error)?;
                file.flush()?;
                file.sync_all()?;
                Ok(())
            }
        }
    }
}
