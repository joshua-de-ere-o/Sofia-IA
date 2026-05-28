export const RECORDATORIOS_REGEX = /\brecordatorios?\b/i;

export function matchesReminderKeyword(text: string) {
  return RECORDATORIOS_REGEX.test(text);
}
