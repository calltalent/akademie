import { describe, expect, it } from "vitest";
import { CALLTALENT_LLC, formatAddress, resolveLegalEntity } from "./company";

describe("legal/company", () => {
  it("führt die Calltalent LLC als Rechtsträger, nicht mehr die alte UK-Gesellschaft", () => {
    expect(CALLTALENT_LLC.name).toBe("Calltalent LLC");
    expect(JSON.stringify(CALLTALENT_LLC)).not.toContain("Ltd");
    expect(JSON.stringify(CALLTALENT_LLC)).not.toContain("16591113");
  });

  it("setzt die Anschrift für Fließtext einzeilig zusammen", () => {
    expect(formatAddress(CALLTALENT_LLC)).toBe(
      "1309 Coffeen Avenue STE 1200, Sheridan, WY 82801, United States",
    );
  });

  it("liest einen vollständigen Mandanten-Rechtsträger aus tenants.legal", () => {
    const entity = resolveLegalEntity({ entity: CALLTALENT_LLC });
    expect(entity?.name).toBe("Calltalent LLC");
  });

  it("ergänzt eine fehlende Registernummer als null statt sie wegzulassen", () => {
    const entity = resolveLegalEntity({
      entity: { name: "Kunde GmbH", addressLines: ["Musterweg 1"], email: "info@example.com" },
    });
    expect(entity?.registrationNumber).toBeNull();
  });

  it("verwirft unvollständige oder fehlende Datensätze (Rechtsseite antwortet dann mit 404)", () => {
    // Halb ausgefüllt: Name ohne Anschrift wäre auf einer Rechtsseite schlimmer
    // als gar keine Seite -> bewusst kein Teilergebnis.
    expect(resolveLegalEntity({ entity: { name: "Kunde GmbH" } })).toBeNull();
    expect(resolveLegalEntity({ entity: { name: "", addressLines: [], email: "x" } })).toBeNull();
    expect(resolveLegalEntity({})).toBeNull();
    expect(resolveLegalEntity(null)).toBeNull();
    expect(resolveLegalEntity(undefined)).toBeNull();
  });
});
