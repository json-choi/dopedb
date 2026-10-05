// Wraps native IPC with opt-in local outcome timing and isolated benchmark timing.

import {
  Channel,
  invoke as nativeInvoke,
} from "@tauri-apps/api/core";
import { recordBenchmarkIpc } from "../benchmarks/packagedMetrics";
import { recordDiagnosticIpc } from "../features/diagnostics/client";

type NativeInvokeParameters = Parameters<typeof nativeInvoke>;

const packagedBenchmark =
  import.meta.env.VITE_DOPEDB_PACKAGED_BENCHMARK === "1";

export { Channel };

/**
 * The application-owned Tauri command boundary.
 *
 * Local diagnostics record command identity, outcome, and duration only.
 * Arguments, errors, and return payloads stay outside the diagnostic boundary.
 * The isolated packaged benchmark keeps its aggregate timing contract.
 */
export async function invoke<T>(
  command: NativeInvokeParameters[0],
  args?: NativeInvokeParameters[1],
  options?: NativeInvokeParameters[2],
): Promise<T> {
  const startedAt = performance.now();
  let failed = false;
  try {
    return await invokeNative<T>(command, args, options);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const elapsed = performance.now() - startedAt;
    if (packagedBenchmark) recordBenchmarkIpc(elapsed);
    else recordDiagnosticIpc(command, elapsed, failed);
  }
}

function invokeNative<T>(
  command: NativeInvokeParameters[0],
  args?: NativeInvokeParameters[1],
  options?: NativeInvokeParameters[2],
) {
  if (options !== undefined) return nativeInvoke<T>(command, args, options);
  if (args !== undefined) return nativeInvoke<T>(command, args);
  return nativeInvoke<T>(command);
}
