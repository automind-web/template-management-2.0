/** Идентификатор операции: повтор нажатия или доставки с тем же opId не создаёт второй записи. */
export function newOpId(): string {
  return crypto.randomUUID();
}
