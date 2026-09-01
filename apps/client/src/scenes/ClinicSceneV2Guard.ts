import { ClinicSceneV2 } from "./ClinicSceneV2";

/**
 * Small runtime guard around the V2 prototype while the scene is being split
 * into smaller systems. A patient whose workflow was explicitly marked complete
 * by the patience-abandon path must leave without incrementing treated/rewards.
 * Successful patients reach the exit with the final `release` step still open,
 * so the original completion handler remains responsible for their reward.
 */
export function installClinicSceneV2Guards(): void {
  const prototype = ClinicSceneV2.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const original = prototype.onPatientRouteComplete;
  if (!original || prototype.__abandonGuardInstalled) return;

  prototype.onPatientRouteComplete = function guardedPatientRouteComplete(this: any, runtime: any) {
    const abandoned = runtime?.moveIntent === "exit" && runtime?.workflow?.completed === true;
    if (!abandoned) return original.call(this, runtime);

    runtime.view.status.setText("WYCHODZI");
    runtime.view.status.setBackgroundColor("#a25e58");
    this.tweens.add({
      targets: runtime.view.container,
      alpha: 0,
      duration: 450,
      onComplete: () => {
        runtime.view.container.destroy(true);
        this.patients.delete(runtime.patient.id);
      },
    });
    return undefined;
  };

  prototype.__abandonGuardInstalled = (() => undefined) as (...args: unknown[]) => unknown;
}
