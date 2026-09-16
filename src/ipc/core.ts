// Every frontend Tauri command call funnels through this one boundary, so the
// packaged benchmark can time IPC without patching Tauri's window internals.
import {
  Channel,
  invoke as nativeInvoke,
} from "@tauri-apps/api/core";
import { recordBenchmarkIpc } from "../benchmarks/packagedMetrics";

type NativeInvokeParameters = Parameters<typeof nativeInvoke>;

const packagedBenchmark =
  import.meta.env.VITE_DOPEDB_PACKAGED_BENCHMARK === "1";

export { Channel };

/**
 * The application-owned Tauri command boundary.
 *
 * Production calls pass through unchanged. The isolated packaged benchmark
 * records only aggregate duration/count metadata here, without replacing or
 * mutating Tauri's private window internals.
 */
export async function invoke<T>(
  command: NativeInvokeParameters[0],
  args?: NativeInvokeParameters[1],
  options?: NativeInvokeParameters[2],
): Promise<T> {
  if (!packagedBenchmark) {
    return invokeNative<T>(command, args, options);
  }

  const startedAt = performance.now();
  try {
    return await invokeNative<T>(command, args, options);
  } finally {
    recordBenchmarkIpc(performance.now() - startedAt);
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
