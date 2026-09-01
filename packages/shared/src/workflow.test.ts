import { describe, expect, it } from "vitest";
import {
  PATIENT_DEFINITIONS,
  advanceWorkflow,
  createPatient,
  createPatientWorkflow,
  currentWorkflowStep,
  workflowProgress,
  workflowRequestedItem,
} from "./index";

describe("patient workflows", () => {
  it("creates a short direct treatment flow for ordinary cases", () => {
    const patient = createPatient(PATIENT_DEFINITIONS[0], 1);
    let workflow = createPatientWorkflow(patient);

    expect(workflow.kind).toBe("simple");
    expect(currentWorkflowStep(workflow)?.action).toBe("admit");

    workflow = advanceWorkflow(workflow, { type: "admit" });
    expect(currentWorkflowStep(workflow)?.destination).toBe("treatment");

    workflow = advanceWorkflow(workflow, { type: "arrive", destination: "treatment" });
    expect(workflowRequestedItem(workflow)).toBe("bandage");

    const unchanged = advanceWorkflow(workflow, { type: "deliver", item: "eyeDrops" });
    expect(unchanged.stepIndex).toBe(workflow.stepIndex);

    workflow = advanceWorkflow(workflow, { type: "deliver", item: "bandage" });
    workflow = advanceWorkflow(workflow, { type: "procedure", procedure: "bandage" });
    workflow = advanceWorkflow(workflow, { type: "release" });

    expect(workflow.completed).toBe(true);
    expect(workflowProgress(workflow)).toEqual({ current: 5, total: 5 });
  });

  it("creates a longer diagnostics to treatment chain for sample-analysis cases", () => {
    const patient = createPatient(PATIENT_DEFINITIONS[2], 1);
    let workflow = createPatientWorkflow(patient);

    expect(workflow.kind).toBe("diagnostic");
    expect(workflow.steps.map((step) => step.destination)).toEqual([
      "reception",
      "analyzer",
      "analyzer",
      "analyzer",
      "treatment",
      "treatment",
      "treatment",
      "exit",
    ]);

    workflow = advanceWorkflow(workflow, { type: "admit" });
    workflow = advanceWorkflow(workflow, { type: "arrive", destination: "analyzer" });
    expect(workflowRequestedItem(workflow)).toBe("sampleKit");

    workflow = advanceWorkflow(workflow, { type: "deliver", item: "sampleKit" });
    workflow = advanceWorkflow(workflow, { type: "procedure", procedure: "sampleAnalysis" });
    expect(currentWorkflowStep(workflow)?.destination).toBe("treatment");

    workflow = advanceWorkflow(workflow, { type: "arrive", destination: "treatment" });
    expect(workflowRequestedItem(workflow)).toBe("treat");

    workflow = advanceWorkflow(workflow, { type: "deliver", item: "treat" });
    workflow = advanceWorkflow(workflow, { type: "procedure", procedure: "calming" });
    workflow = advanceWorkflow(workflow, { type: "release" });

    expect(workflow.completed).toBe(true);
  });
});
