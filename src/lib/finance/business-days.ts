export type HolidayKind = "nacional" | "estadual" | "municipal" | "bancario";
export type Holiday = { day: string; name: string; kind: HolidayKind; source: string };

const FEDERAL = "Lei 662/1949 (redação da Lei 10.607/2002)";
const MUNICIPAL = "Lei Municipal 1.997/1967";

const FIXED: ReadonlyArray<{ md: string; name: string; kind: HolidayKind; source: string }> = [
  { md: "01-01", name: "Confraternização Universal", kind: "nacional", source: FEDERAL },
  { md: "04-21", name: "Tiradentes", kind: "nacional", source: FEDERAL },
  { md: "05-01", name: "Dia do Trabalho", kind: "nacional", source: FEDERAL },
  { md: "06-24", name: "São João", kind: "municipal", source: MUNICIPAL },
  { md: "07-02", name: "Independência da Bahia (Dois de Julho)", kind: "estadual", source: "Constituição do Estado da Bahia, art. 6º, § 3º" },
  { md: "09-07", name: "Independência do Brasil", kind: "nacional", source: FEDERAL },
  { md: "10-12", name: "Nossa Senhora Aparecida", kind: "nacional", source: "Lei 6.802/1980" },
  { md: "11-02", name: "Finados", kind: "nacional", source: FEDERAL },
  { md: "11-15", name: "Proclamação da República", kind: "nacional", source: FEDERAL },
  { md: "11-20", name: "Zumbi e Consciência Negra", kind: "nacional", source: "Lei 14.759/2023" },
  { md: "12-08", name: "Nossa Senhora da Conceição da Praia", kind: "municipal", source: MUNICIPAL },
  { md: "12-25", name: "Natal", kind: "nacional", source: FEDERAL },
];

const MOVABLE: ReadonlyArray<{ offset: number; name: string; kind: HolidayKind; source: string }> = [
  { offset: -48, name: "Segunda-feira de Carnaval", kind: "bancario", source: "Resolução CMN 4.880/2020, art. 6º, I" },
  { offset: -47, name: "Terça-feira de Carnaval", kind: "bancario", source: "Resolução CMN 4.880/2020, art. 6º, I" },
  { offset: -2, name: "Sexta-feira da Paixão", kind: "municipal", source: `${MUNICIPAL}; Lei 9.093/1995, art. 2º` },
  { offset: 60, name: "Corpus Christi", kind: "municipal", source: `${MUNICIPAL}; Resolução CMN 4.880/2020, art. 6º, II` },
];

function key(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return key(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Algoritmo anônimo gregoriano (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(new Date(Date.UTC(year, month - 1, day)));
}

export function salvadorHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  return [
    ...FIXED.map((h) => ({ day: `${year}-${h.md}`, name: h.name, kind: h.kind, source: h.source })),
    ...MOVABLE.map((h) => ({ day: addDays(easter, h.offset), name: h.name, kind: h.kind, source: h.source })),
  ].sort((x, y) => x.day.localeCompare(y.day));
}

export function isBusinessDay(dayKey: string, holidays: ReadonlySet<string>): boolean {
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5 && !holidays.has(dayKey);
}

/** O próprio dia inicial conta, se for útil. */
export function nthBusinessDay(startKey: string, n: number, holidays: ReadonlySet<string>): string {
  let day = startKey;
  let count = 0;
  for (let guard = 0; guard < 120; guard++) {
    if (isBusinessDay(day, holidays) && ++count === n) return day;
    day = addDays(day, 1);
  }
  throw new Error("Prazo fora do alcance do calendário.");
}

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function holidaySeedSql(fromYear: number, toYear: number): string {
  const rows: string[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    for (const h of salvadorHolidays(year)) {
      rows.push(`  ('${h.day}', ${sqlText(h.name)}, '${h.kind}', ${sqlText(h.source)})`);
    }
  }
  return `insert into public.business_holidays (day, name, kind, source) values\n${rows.join(",\n")};`;
}
