import XLSX from "xlsx";
import type { Company } from "./types.js";

export function readCompanies(
  filePath: string,
  limit?: number,
): Company[] {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  const companies: Company[] = [];

  for (const row of rows) {
    const url = String(row["favoriteUrl"] ?? "").trim();
    const name = String(row["name"] ?? "").trim();
    const id = String(row["id"] ?? "").trim();

    // Skip rows without a valid URL or name
    if (!url || !name || !id) continue;
    if (!url.startsWith("http")) continue;

    companies.push({
      id,
      name,
      url,
      description: row["Description"]
        ? String(row["Description"]).trim()
        : undefined,
      industry: row["Industries"]
        ? String(row["Industries"]).trim()
        : undefined,
      employees: row["Number of Employees"]
        ? String(row["Number of Employees"]).trim()
        : undefined,
      revenue: row["Estimated Revenue"]
        ? String(row["Estimated Revenue"]).trim()
        : undefined,
    });

    if (limit && companies.length >= limit) break;
  }

  return companies;
}
