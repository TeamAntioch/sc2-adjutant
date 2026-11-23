// What a tutorial step needs, as chips (#980, #981), in the objectives rail and on the step: the
// Host Adapters that have its capabilities, and the Finders whose tools it calls.
import { Fragment } from "react";

import type { FinderName, Objective } from "@/lib/reference-types";

const CHIP = "inline-block whitespace-nowrap border border-amber-400/70 px-1 py-px align-[1px] font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-400";

/** Whether a step needs anything: a Host Adapter capability or a Finder. */
export const needsAny = (step: Objective) => step.needs.length > 0 || step.finders.length > 0;

/** The Host Adapters that have a step's capabilities, as a chip: "macOS · Windows host". */
export function HostChip({ step }: { step: Objective }) {
  if (!step.needs.length) return null;
  return (
    <span title={`Needs a Host Adapter with ${step.needs.join(", ")}`} className={CHIP}>
      {step.hostAdapters.join(" · ")} host
    </span>
  );
}

/** A Finder a step needs, as a chip: "Doodad Finder". */
export function FinderChip({ finder }: { finder: FinderName }) {
  return (
    <span title={`Needs the ${finder}`} className={CHIP}>
      {finder}
    </span>
  );
}

/** Everything a step needs, as chips: its host's, then each Finder's. */
export function NeedsChip({ step }: { step: Objective }) {
  const chips = [...(step.needs.length ? [<HostChip key="host" step={step} />] : []), ...step.finders.map((finder) => <FinderChip key={finder} finder={finder} />)];
  return chips.map((chip, at) => (
    <Fragment key={chip.key}>
      {at > 0 && " "}
      {chip}
    </Fragment>
  ));
}
