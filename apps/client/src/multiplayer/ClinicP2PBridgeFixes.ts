import { ClinicSceneV2 } from "../scenes/ClinicSceneV2";

/**
 * Small lifecycle fixes kept separate from the bridge so the networking layer
 * can stay reviewable while ClinicSceneV2 is still being split into systems.
 */
export function installClinicSceneV2P2PFixes(): void {
  const prototype = ClinicSceneV2.prototype as any;
  if (prototype.__p2pBridgeFixesInstalled) return;

  const originalCreate = prototype.create;
  prototype.create = function p2pFixedCreate(this: any, ...args: any[]) {
    const result = originalCreate.apply(this, args);
    const runtime = this.__p2pBridgeRuntime as any;
    if (!runtime || runtime.__animalCareFixesApplied) return result;

    const originalBeforeHostUpdate = runtime.beforeHostUpdate.bind(runtime);
    runtime.beforeHostUpdate = (scene: any, delta: number) => {
      const ownerId = runtime.remoteMinigameOwner as string;
      const actor = ownerId ? runtime.actors?.get(ownerId) : undefined;
      const pendingInteract = Boolean(actor?.input?.interact);
      const pendingNumberChoice = actor?.input?.numberChoice;

      originalBeforeHostUpdate(scene, delta);

      // beforeHostUpdate normally consumes one-shot interaction flags after
      // world interactions. A remote-owned minigame consumes those flags later
      // in ClinicSceneV2.updateMinigame(), so restore them for that one frame.
      if (actor && ownerId && scene.activeMinigame) {
        if (pendingInteract) actor.input.interact = true;
        if (pendingNumberChoice !== undefined) actor.input.numberChoice = pendingNumberChoice;
      }
    };

    runtime.detach = () => {
      for (const actor of runtime.actors?.values?.() ?? []) {
        actor.label?.destroy?.();
        actor.sprite?.destroy?.();
      }
      runtime.actors?.clear?.();
      runtime.remoteMinigameOwner = "";
      runtime.scene = undefined;
      // Do not remove P2PSession listeners here. A Phaser scene restart is a
      // new shift, not a network leave; attach() will point them at the new scene.
    };

    runtime.__animalCareFixesApplied = true;
    return result;
  };

  prototype.__p2pBridgeFixesInstalled = true;
}
