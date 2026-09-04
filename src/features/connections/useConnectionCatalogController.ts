// Owns driver/source catalog queries, search and selection state, driver
// installation, and the add-data-source command menu.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Engine, Provider } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import { isDocumentEngine } from "../../lib/capabilities";
import { useI18n } from "../../lib/i18n";
import { driversQuery } from "../../lib/queries";
import type { ProviderKind } from "../providers/domain";
import {
  compatibleDrivers,
  STANDARD_CONNECTION_SOURCES,
  switchConnectionSource,
  type ConnectionEditorView,
  type StandardConnectionSource,
} from "./connectionEditorModel";
import type { ConnectionProfile, DriverDescriptor } from "./domain";
import type { ConnectionLaunchPreset } from "./presets";
import { installDriver } from "./tauriAdapter";
import type { ConnectionProfileState } from "./useConnectionProfileState";

type OpenProviderCredentials = (
  provider?: ProviderKind,
  returnFocus?: HTMLElement | null,
) => void;

export function useConnectionCatalogController({
  connections,
  onNewConnection,
  openProviderCredentials,
  profileState,
}: {
  connections: ConnectionProfile[];
  onNewConnection: (preset?: ConnectionLaunchPreset) => void;
  openProviderCredentials: OpenProviderCredentials;
  profileState: ConnectionProfileState;
}) {
  const { t } = useI18n();
  const driverCatalog = useQuery(driversQuery());
  const { form, identity, credentials, tabs, status } = profileState;
  const [installingDriverId, setInstallingDriverId] = useState<
    string | null
  >(null);
  const [editorView, setEditorView] =
    useState<ConnectionEditorView>("dataSources");
  const [sourceSearch, setSourceSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [catalogSearchOpen, setCatalogSearchOpen] = useState(false);
  const [catalogCloudProvider, setCatalogCloudProvider] =
    useState<ProviderKind>("neon");
  const [catalogDriverId, setCatalogDriverId] = useState<string | null>(
    null,
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const addMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  const drivers = compatibleDrivers(
    driverCatalog.data ?? [],
    form.value.engine,
    form.value.provider,
  );
  const activeDriver = form.value.driverId
    ? drivers.find((driver) => driver.id === form.value.driverId) ?? null
    : drivers.find((driver) => driver.recommended) ?? drivers[0] ?? null;
  const normalizedSourceSearch = sourceSearch.trim().toLocaleLowerCase();
  const visibleConnections = normalizedSourceSearch
    ? connections.filter((connection) =>
        [
          connection.name,
          connection.engine,
          connection.provider,
          connection.host,
          connection.database,
        ].some((value) =>
          value.toLocaleLowerCase().includes(normalizedSourceSearch),
        ),
      )
    : connections;
  const normalizedDriverSearch = driverSearch.trim().toLocaleLowerCase();
  const visibleCatalogDrivers = (driverCatalog.data ?? []).filter(
    (driver) =>
      driver.installState !== "planned" &&
      (normalizedDriverSearch.length === 0 ||
        [
          driver.name,
          driver.engine,
          driver.version,
          ...driver.supportedProviders,
          ...driver.capabilities,
        ].some((value) =>
          value.toLocaleLowerCase().includes(normalizedDriverSearch),
        )),
  );
  const catalogDriver =
    visibleCatalogDrivers.find((driver) => driver.id === catalogDriverId) ??
    visibleCatalogDrivers.find((driver) => driver.id === activeDriver?.id) ??
    visibleCatalogDrivers[0] ??
    null;
  const cloudProviders: Array<{ provider: ProviderKind; label: string }> = [
    { provider: "neon", label: t("connections.providerNeon") },
    {
      provider: "gcpCloudSql",
      label: t("connections.providerGcpCloudSql"),
    },
    {
      provider: "planetScale",
      label: t("connections.providerPlanetScale"),
    },
  ];
  const normalizedAddSearch = addSearch.trim().toLocaleLowerCase();
  const matchesAddSearch = (...values: string[]) =>
    normalizedAddSearch.length === 0 ||
    values.some((value) =>
      value.toLocaleLowerCase().includes(normalizedAddSearch),
    );
  const filteredDatabaseSources = STANDARD_CONNECTION_SOURCES.filter(
    (source) =>
      source.category === "database" &&
      matchesAddSearch(
        source.label,
        source.engine,
        t("connections.database"),
        "sql",
        sourceDriverDescription(source),
      ),
  );
  const filteredFileSources = STANDARD_CONNECTION_SOURCES.filter(
    (source) =>
      source.category === "file" &&
      matchesAddSearch(
        source.label,
        source.engine,
        t("connections.fileAndSample"),
        "file",
        sourceDriverDescription(source),
      ),
  );
  const filteredCloudProviders = cloudProviders.filter(
    (provider) =>
      provider.provider === "gcpCloudSql" &&
      matchesAddSearch(
        provider.label,
        provider.provider,
        t("connections.clouds"),
        t("connections.dataSourceFromCloudProvider"),
        "cloud",
      ),
  );
  const demoMatches = matchesAddSearch(
    t("connections.demoSqlite"),
    t("connections.sampleDatabase"),
    "demo sqlite",
    "sample",
  );
  const hasAddResults =
    filteredDatabaseSources.length > 0 ||
    filteredFileSources.length > 0 ||
    filteredCloudProviders.length > 0 ||
    demoMatches;

  function selectSource(engine: Engine, provider: Provider = "auto") {
    form.setValue((current) =>
      switchConnectionSource(current, engine, provider),
    );
    if (engine === "bigquery") {
      credentials.setPassword("");
    }
    if (
      engine === "bigquery" ||
      (tabs.active === "schemas" && isDocumentEngine(engine))
    ) {
      tabs.setActive("general");
    }
  }

  function selectAddSource(source: StandardConnectionSource) {
    setAddMenuOpen(false);
    setAddSearch("");
    if (identity.isNew) {
      selectSource(source.engine, source.provider);
      return;
    }
    onNewConnection({
      engine: source.engine,
      provider: source.provider,
      source: "standard",
    });
  }

  function sourceDriverDescription(source: StandardConnectionSource) {
    const compatible = compatibleDrivers(
      driverCatalog.data ?? [],
      source.engine,
      source.provider,
    );
    const driver =
      compatible.find((candidate) => candidate.recommended) ?? compatible[0];
    return driver
      ? `${driver.name} ${driver.version}`
      : t("connections.driverCatalogLoading");
  }

  async function downloadDriver(driver: DriverDescriptor) {
    setInstallingDriverId(driver.id);
    status.setMessage(null);
    try {
      await installDriver(driver.id);
      await driverCatalog.refetch();
      status.setMessage(
        t("connections.driverInstalled", { name: driver.name }),
      );
      status.setMessageIsError(false);
    } catch (error) {
      status.setMessage(errMessage(error));
      status.setMessageIsError(true);
    } finally {
      setInstallingDriverId(null);
    }
  }

  function driverStatus(driver: DriverDescriptor) {
    if (driver.installMode === "bundled") {
      return t("connections.driverBundled");
    }
    if (driver.installMode === "system") {
      return driver.installState === "installed"
        ? t("connections.driverSystem")
        : t("connections.driverSystemRequired");
    }
    if (driver.installState === "installed") {
      return t("connections.driverInstalledStatus");
    }
    return t("connections.driverDownloadRequired");
  }

  function providerLabel(provider: Provider) {
    if (provider === "auto") return t("connections.providerAuto");
    if (provider === "generic") return t("connections.providerGeneric");
    if (provider === "neon") return t("connections.providerNeon");
    if (provider === "planetScale") {
      return t("connections.providerPlanetScale");
    }
    return t("connections.providerGcpCloudSql");
  }

  return {
    model: { driverCatalog },
    view: {
      navigation: {
        view: editorView,
        setView: setEditorView,
        searchOpen: catalogSearchOpen,
        setSearchOpen: setCatalogSearchOpen,
      },
      sources: {
        available: STANDARD_CONNECTION_SOURCES,
        connections,
        visibleConnections,
        search: sourceSearch,
        setSearch: setSourceSearch,
        filteredDatabaseSources,
        filteredFileSources,
        selectAddSource,
        sourceDriverDescription,
      },
      addMenu: {
        open: addMenuOpen,
        setOpen: setAddMenuOpen,
        search: addSearch,
        setSearch: setAddSearch,
        anchorRef: addMenuAnchorRef,
        buttonRef: addButtonRef,
        filteredCloudProviders,
        demoMatches,
        hasResults: hasAddResults,
        openProviderCredentials,
      },
      drivers: {
        pending: driverCatalog.isPending,
        failed: driverCatalog.isError,
        fetching: driverCatalog.isFetching,
        refresh: driverCatalog.refetch,
        compatible: drivers,
        active: activeDriver,
        visible: visibleCatalogDrivers,
        selected: catalogDriver,
        select: setCatalogDriverId,
        search: driverSearch,
        setSearch: setDriverSearch,
        installingId: installingDriverId,
        download: downloadDriver,
        status: driverStatus,
      },
      clouds: {
        providers: cloudProviders,
        selected: catalogCloudProvider,
        select: setCatalogCloudProvider,
        providerLabel,
        openProviderCredentials,
      },
    },
  };
}

export type ConnectionCatalogController = ReturnType<
  typeof useConnectionCatalogController
>;
