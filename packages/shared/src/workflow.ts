import type { ItemType, PatientCase, ProcedureType, StationKind } from "./domain";

export type WorkflowKind = "simple" | "diagnostic";
export type WorkflowDestination = "reception" | "analyzer" | "treatment" | "exit";
export type WorkflowAction = "admit" | "arrive" | "deliver" | "procedure" | "release";

export interface WorkflowStep {
  id: string;
  destination: WorkflowDestination;
  action: WorkflowAction;
  label: string;
  item?: ItemType;
  procedure?: ProcedureType;
}

export interface PatientWorkflow {
  patientId: string;
  kind: WorkflowKind;
  steps: WorkflowStep[];
  stepIndex: number;
  completed: boolean;
}

export type WorkflowEvent =
  | { type: "admit" }
  | { type: "arrive"; destination: WorkflowDestination }
  | { type: "deliver"; item: ItemType }
  | { type: "procedure"; procedure?: ProcedureType }
  | { type: "release" };

function simpleSteps(patient: PatientCase): WorkflowStep[] {
  return [
    { id: "admit", destination: "reception", action: "admit", label: "Przyjmij pacjenta" },
    { id: "treatment-arrival", destination: "treatment", action: "arrive", label: "Zaprowadź do gabinetu" },
    {
      id: "treatment-item",
      destination: "treatment",
      action: "deliver",
      item: patient.requiredItem,
      label: `Dostarcz: ${patient.requiredItem}`,
    },
    {
      id: "treatment-procedure",
      destination: "treatment",
      action: "procedure",
      procedure: patient.procedure,
      label: "Wykonaj zabieg",
    },
    { id: "release", destination: "exit", action: "release", label: "Pacjent może wyjść" },
  ];
}

function diagnosticSteps(patient: PatientCase): WorkflowStep[] {
  return [
    { id: "admit", destination: "reception", action: "admit", label: "Przyjmij pacjenta" },
    { id: "diagnostics-arrival", destination: "analyzer", action: "arrive", label: "Skieruj do diagnostyki" },
    {
      id: "sample-kit",
      destination: "analyzer",
      action: "deliver",
      item: "sampleKit",
      label: "Dostarcz zestaw próbek",
    },
    {
      id: "sample-analysis",
      destination: "analyzer",
      action: "procedure",
      procedure: "sampleAnalysis",
      label: "Przeanalizuj próbkę",
    },
    { id: "treatment-arrival", destination: "treatment", action: "arrive", label: "Skieruj do gabinetu po wyniku" },
    {
      id: "post-diagnosis-item",
      destination: "treatment",
      action: "deliver",
      item: patient.species === "rabbit" ? "treat" : "eyeDrops",
      label: patient.species === "rabbit" ? "Dostarcz przysmak uspokajający" : "Dostarcz lek po diagnozie",
    },
    {
      id: "post-diagnosis-procedure",
      destination: "treatment",
      action: "procedure",
      procedure: patient.species === "rabbit" ? "calming" : "eyeDrops",
      label: "Wykonaj leczenie po diagnozie",
    },
    { id: "release", destination: "exit", action: "release", label: "Pacjent może wyjść" },
  ];
}

export function createPatientWorkflow(patient: PatientCase): PatientWorkflow {
  const kind: WorkflowKind = patient.procedure === "sampleAnalysis" ? "diagnostic" : "simple";
  return {
    patientId: patient.id,
    kind,
    steps: kind === "diagnostic" ? diagnosticSteps(patient) : simpleSteps(patient),
    stepIndex: 0,
    completed: false,
  };
}

export function currentWorkflowStep(workflow: PatientWorkflow): WorkflowStep | undefined {
  return workflow.completed ? undefined : workflow.steps[workflow.stepIndex];
}

export function workflowProgress(workflow: PatientWorkflow): { current: number; total: number } {
  return {
    current: Math.min(workflow.stepIndex + 1, workflow.steps.length),
    total: workflow.steps.length,
  };
}

export function workflowDestinationStationKind(step: WorkflowStep | undefined): StationKind | undefined {
  if (!step || step.destination === "exit") return undefined;
  if (step.destination === "reception") return "reception";
  if (step.destination === "analyzer") return "analyzer";
  return "treatment";
}

export function workflowAcceptsEvent(step: WorkflowStep | undefined, event: WorkflowEvent): boolean {
  if (!step || step.action !== event.type) return false;
  if (event.type === "arrive") return step.destination === event.destination;
  if (event.type === "deliver") return step.item === event.item;
  if (event.type === "procedure") return !step.procedure || !event.procedure || step.procedure === event.procedure;
  return true;
}

export function advanceWorkflow(workflow: PatientWorkflow, event: WorkflowEvent): PatientWorkflow {
  const step = currentWorkflowStep(workflow);
  if (!workflowAcceptsEvent(step, event)) return workflow;

  const nextIndex = workflow.stepIndex + 1;
  return {
    ...workflow,
    stepIndex: Math.min(nextIndex, workflow.steps.length),
    completed: nextIndex >= workflow.steps.length,
  };
}

export function workflowRequestedItem(workflow: PatientWorkflow): ItemType | undefined {
  return currentWorkflowStep(workflow)?.item;
}

export function workflowProcedure(workflow: PatientWorkflow): ProcedureType | undefined {
  return currentWorkflowStep(workflow)?.procedure;
}
