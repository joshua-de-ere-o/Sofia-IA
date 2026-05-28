export function appendForcedReminderHistory({
  provider,
  history,
  toolName,
  toolInput,
  toolResult,
  syntheticId,
}: {
  provider: string;
  history: any[];
  toolName: string;
  toolInput: Record<string, any>;
  toolResult: string;
  syntheticId: string;
}) {
  if (provider === "gemini") {
    history.push({
      role: "user",
      content:
        `[CONTEXTO SISTEMA: La ruta determinística de recordatorios ejecutó la herramienta ${toolName} antes de llamar al modelo. Tomá este resultado como estado interno y continuá normalmente con el usuario.]\n${toolResult}`,
    });
    return;
  }

  history.push({
    role: "assistant",
    content: "",
    tool_calls: [{
      id: syntheticId,
      name: toolName,
      input: toolInput,
    }],
  });
  history.push({
    role: "tool",
    name: toolName,
    tool_call_id: syntheticId,
    tool_use_id: syntheticId,
    content: toolResult,
  });
}
