export const REGISTERED_EXECUTION_METHODS = ["GET", "HEAD"] as const;
export type RegisteredExecutionMethod = (typeof REGISTERED_EXECUTION_METHODS)[number];
export type RegisteredParameterType = "string" | "number" | "integer" | "boolean";

export type RegisteredExecutionParameter = {
  name: string;
  type: RegisteredParameterType;
  required: boolean;
  location: "query";
};

export type RegisteredExecutionOperation = {
  method: RegisteredExecutionMethod;
  path: string;
  parameters: RegisteredExecutionParameter[];
  cost?: { amount: number; currency: string };
};

const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function metadataError(message: string, code = "INVALID_EXECUTION_METADATA"): never {
  throw Object.assign(new Error(message), { code });
}

function registeredPath(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return metadataError("Die registrierte Service-URL ist ungültig.", "INVALID_URL");
  }
  if (url.search || url.hash) {
    return metadataError(
      "Eine kontrollierte Service-URL darf keine Query- oder Fragmentwerte vorwegnehmen.",
    );
  }
  return url.pathname || "/";
}

function normalizeOperation(
  raw: unknown,
  expectedPath: string,
): RegisteredExecutionOperation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return metadataError("Jede Execution-Operation muss ein Objekt sein.");
  }
  const value = raw as Record<string, unknown>;
  const method = typeof value.method === "string" ? value.method.toUpperCase() : "";
  if (!REGISTERED_EXECUTION_METHODS.includes(method as RegisteredExecutionMethod)) {
    return metadataError("Nur registrierte GET-/HEAD-Operationen dürfen ausgeführt werden.");
  }
  if (typeof value.path !== "string" || value.path !== expectedPath || !value.path.startsWith("/")) {
    return metadataError(
      "Die Operation muss exakt auf den Pfad der registrierten Service-URL zeigen.",
    );
  }
  if (value.url !== undefined || value.target !== undefined) {
    return metadataError("Execution-Metadaten dürfen keine alternative Ziel-URL enthalten.");
  }

  const rawParameters = value.parameters ?? [];
  if (!Array.isArray(rawParameters)) {
    return metadataError("Die Parameterdefinition muss eine Liste sein.");
  }
  const seen = new Set<string>();
  const parameters = rawParameters.map((rawParameter) => {
    if (!rawParameter || typeof rawParameter !== "object" || Array.isArray(rawParameter)) {
      return metadataError("Jeder registrierte Parameter muss ein Objekt sein.");
    }
    const parameter = rawParameter as Record<string, unknown>;
    const name = typeof parameter.name === "string" ? parameter.name : "";
    const type = typeof parameter.type === "string" ? parameter.type : "";
    const location = parameter.location ?? "query";
    if (!PARAMETER_NAME.test(name) || seen.has(name)) {
      return metadataError("Parameternamen müssen eindeutig und sicher begrenzt sein.");
    }
    if (!["string", "number", "integer", "boolean"].includes(type)) {
      return metadataError("Nur string, number, integer und boolean sind als Parametertyp erlaubt.");
    }
    if (location !== "query") {
      return metadataError("Nur Query-Parameter sind für sichere GET-/HEAD-Operationen erlaubt.");
    }
    seen.add(name);
    return {
      name,
      type: type as RegisteredParameterType,
      required: parameter.required === true,
      location: "query" as const,
    };
  });

  const rawCost = value.cost;
  let cost: RegisteredExecutionOperation["cost"];
  if (rawCost !== undefined) {
    if (!rawCost || typeof rawCost !== "object" || Array.isArray(rawCost)) {
      return metadataError("Kosten müssen als begrenztes Objekt deklariert werden.");
    }
    const costValue = rawCost as Record<string, unknown>;
    if (
      typeof costValue.amount !== "number" ||
      !Number.isFinite(costValue.amount) ||
      costValue.amount < 0 ||
      typeof costValue.currency !== "string" ||
      !/^[A-Z]{3,8}$/.test(costValue.currency)
    ) {
      return metadataError("Kosten dürfen nur als bekannte, nichtnegative Währungssumme angegeben werden.");
    }
    cost = { amount: costValue.amount, currency: costValue.currency };
  }

  return {
    method: method as RegisteredExecutionMethod,
    path: expectedPath,
    parameters,
    ...(cost ? { cost } : {}),
  };
}

export function normalizeExecutionMetadata(
  metadata: Record<string, unknown> | null | undefined,
  serviceUrl: string,
  options: { requireOperations?: boolean; requireHttps?: boolean } = {},
) {
  const requireOperations = options.requireOperations === true;
  const requireHttps = options.requireHttps === true;
  const path = registeredPath(serviceUrl);
  const parsedUrl = new URL(serviceUrl);
  if (requireHttps && parsedUrl.protocol !== "https:") {
    return metadataError("Kontrollierte externe Services müssen HTTPS verwenden.", "UNSAFE_URL");
  }

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    if (requireOperations) {
      return metadataError("Kontrollierte externe Services benötigen Execution-Metadaten.");
    }
    return metadata ?? null;
  }

  const execution = metadata.execution;
  if (execution === undefined) {
    if (requireOperations) {
      return metadataError("Kontrollierte externe Services benötigen mindestens eine Operation.");
    }
    return metadata;
  }
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    return metadataError("Execution-Metadaten müssen ein Objekt sein.");
  }
  const rawOperations = (execution as Record<string, unknown>).operations;
  if (!Array.isArray(rawOperations) || rawOperations.length === 0 || rawOperations.length > 16) {
    return metadataError("Es muss mindestens eine und dürfen höchstens 16 Operationen geben.");
  }
  const operations = rawOperations.map((operation) => normalizeOperation(operation, path));
  return {
    ...metadata,
    execution: {
      ...(execution as Record<string, unknown>),
      operations,
    },
  };
}

export function getRegisteredExecutionOperations(
  serviceUrl: string,
  metadata: Record<string, unknown> | null | undefined,
  options: {
    requireOperations?: boolean;
    defaultMethod?: RegisteredExecutionMethod;
  } = {},
): RegisteredExecutionOperation[] {
  try {
    const normalized = normalizeExecutionMetadata(metadata, serviceUrl, options);
    const execution: unknown =
      normalized && typeof normalized === "object" && !Array.isArray(normalized)
        ? normalized.execution
        : undefined;
    const operations =
      execution && typeof execution === "object" && !Array.isArray(execution)
        ? (execution as Record<string, unknown>).operations
        : undefined;
    if (Array.isArray(operations)) return operations as RegisteredExecutionOperation[];
  } catch {
    return [];
  }
  if (options.requireOperations) return [];
  const url = new URL(serviceUrl);
  return [{
    method: options.defaultMethod ?? "GET",
    path: url.pathname || "/",
    parameters: [],
  }];
}