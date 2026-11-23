// The Host: the author's machine as core sees it, that is, its machine config and the Host Adapter
// Plugin it names. Core asks the Host whether a capability exists before using it, so every tool
// works on a machine with no Host Adapter at all.

import type { HostCapabilities, HostCapabilityName, LoadedPlugin, PluginRegistry } from "../plugins/plugin-api.js";
import { EMPTY_REGISTRY } from "../plugins/plugin-api.js";
import { loadPlugins } from "../plugins/registry.js";
import { emptyMachineConfig, hostContext, type MachineConfig } from "./machine-config.js";

export type Host = {
  readonly machine: MachineConfig;
  /** The Host Adapter Plugin, if the machine config names one. */
  readonly adapter: LoadedPlugin | undefined;
  has(name: HostCapabilityName): boolean;
  /** Runs a capability; check `has` first, since a missing one throws. */
  run<Name extends HostCapabilityName>(name: Name, request: Parameters<HostCapabilities[Name]>[0]): ReturnType<HostCapabilities[Name]>;
};

/**
 * Loads the Host Adapter the machine config names, if any. One it names must load; with none named,
 * the machine has no Host Adapter, and tools that need a capability hand off to the author.
 */
export async function loadHost(machine: MachineConfig): Promise<Host> {
  if (!machine.hostAdapter) return hostOf(machine, EMPTY_REGISTRY);
  const registry = await loadPlugins(machine.hostAdapterRoot, [{ source: machine.hostAdapter, roles: ["host-adapter"] }]);
  const adapter = registry.plugins[0]!;
  if (adapter.contributions.mechanics.length > 0) {
    throw new Error(
      `Host Adapter ${adapter.name} (${adapter.source}, from ${machine.file}) contributes Mechanics; a Mission's Mechanics come from its Workspace's Plugins, so name a Plugin with Mechanics in the Workspace config`,
    );
  }
  return hostOf(machine, registry);
}

/**
 * Refuses a bulk job, one with no manual form, when the host lacks the capability it needs. `job`
 * names it for the author, as in "Rendering thumbnails".
 */
export function requireCapability(host: Host, name: HostCapabilityName, job: string): void {
  if (host.has(name)) return;
  const adapter = host.adapter ? `${host.adapter.name}, from ${host.machine.file}` : "none";
  throw new Error(`${job} needs the ${name} capability, and the machine's Host Adapter (${adapter}) doesn't have it`);
}

/** A machine with no Host Adapter: every capability is missing. */
export function bareHost(machine: MachineConfig = emptyMachineConfig()): Host {
  return hostOf(machine, EMPTY_REGISTRY);
}

function hostOf(machine: MachineConfig, registry: PluginRegistry): Host {
  const context = hostContext(machine);
  const adapter = registry.plugins[0];
  return {
    machine,
    adapter,
    has: (name) => registry.capability(name) !== undefined,
    run(name, request) {
      const capability = registry.capability(name) as ((request: unknown, context: unknown) => ReturnType<HostCapabilities[typeof name]>) | undefined;
      if (!capability) return Promise.reject(new Error(`The machine's Host Adapter (${adapter ? adapter.name : "none"}) has no ${name} capability`)) as ReturnType<HostCapabilities[typeof name]>;
      // A capability that throws before it returns a promise still rejects, as an async one would.
      try {
        return capability(request, context);
      } catch (error) {
        return Promise.reject(error) as ReturnType<HostCapabilities[typeof name]>;
      }
    },
  };
}
