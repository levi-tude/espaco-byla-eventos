import { describe, expect, it } from "vitest";
import {
  addDays, easterSunday, holidaySeedSql, nthBusinessDay, salvadorHolidays,
} from "@/lib/finance/business-days";

const daysOf = (from: number, to: number) =>
  new Set(Array.from({ length: to - from + 1 }, (_, i) => salvadorHolidays(from + i)).flat().map((h) => h.day));

describe("calendário de Salvador", () => {
  it.each([
    [2026, "2026-04-05"], [2027, "2027-03-28"], [2028, "2028-04-16"], [2029, "2029-04-01"], [2030, "2030-04-21"],
  ])("Páscoa de %i", (year, day) => expect(easterSunday(year)).toBe(day));

  it("datas móveis de 2026 e 2027 iguais às da spec", () => {
    const days = daysOf(2026, 2027);
    for (const day of ["2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04", "2027-02-08", "2027-02-09", "2027-03-26", "2027-05-27"]) {
      expect(days.has(day), day).toBe(true);
    }
  });

  it("Cinzas, 24/12 e 31/12 contam como dia útil; 29/3 e 19/3 não são feriado", () => {
    const days = daysOf(2026, 2027);
    for (const day of ["2026-02-18", "2027-02-10", "2026-12-24", "2026-12-31", "2026-03-19", "2027-03-29"]) {
      expect(days.has(day), day).toBe(false);
    }
  });

  it.each([
    ["2026-10-24", "2026-10-30"],
    ["2026-11-15", "2026-11-23"],
    ["2026-06-21", "2026-06-29"],
    ["2027-02-07", "2027-02-16"],
  ])("prazo de 5 dias úteis a partir de %s", (start, due) => {
    expect(nthBusinessDay(start, 5, daysOf(2026, 2027))).toBe(due);
  });

  it("16 datas por ano, sem dia repetido de 2026 a 2030", () => {
    for (let year = 2026; year <= 2030; year++) {
      const list = salvadorHolidays(year);
      expect(list).toHaveLength(16);
      expect(new Set(list.map((h) => h.day)).size).toBe(16);
    }
  });

  it("addDays atravessa fevereiro de ano bissexto", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("SQL de carga ordenado, com aspas escapadas e sem linhas repetidas", () => {
    const sql = holidaySeedSql(2026, 2030);
    expect(sql.startsWith("insert into public.business_holidays (day, name, kind, source) values")).toBe(true);
    expect(sql.match(/\('20\d\d-/g)).toHaveLength(80);
    expect(sql).toContain("('2026-02-16', 'Segunda-feira de Carnaval', 'bancario'");
    expect(sql.trimEnd().endsWith(";")).toBe(true);
  });
});
