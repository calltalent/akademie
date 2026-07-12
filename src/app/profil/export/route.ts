import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exportUserData } from "@/lib/gdpr/export";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { genericErrorMessage } from "@/lib/errors/generic";

/**
 * GET /profil/export — Selbst-Service-Datenexport (Art. 15/20 DSGVO),
 * Phase 4 Block 3. Route Handler statt Server Action, weil Server Actions
 * keine Datei-Downloads mit `Content-Disposition` ausliefern können
 * (siehe PHASENSTATUS.md Block-3-Plan).
 *
 * SICHERHEITSKRITISCH: `userId` kommt AUSSCHLIESSLICH aus
 * `supabase.auth.getUser()` (Session-Client, RLS-gebunden) — niemals aus
 * Query-Parametern oder dem Request-Body, sonst könnte ein Nutzer fremde
 * Daten exportieren. Erst NACH dieser Identitätsprüfung wird für die
 * eigentliche Datensammlung auf den Admin-Client (service_role)
 * umgeschaltet, weil RLS bei manchen der gesammelten Tabellen sonst zu
 * restriktiv/inkonsistent filtern würde (siehe Kommentar in
 * src/lib/gdpr/export.ts) — die Autorisierung ist zu diesem Zeitpunkt
 * bereits durch die Session-Prüfung erfolgt.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    }

    // BUGFIX (Security-Audit Block 7, 12.07.2026): dieser Export löst 8
    // parallele Tabellenabfragen aus, hatte aber im Gegensatz zu praktisch
    // jedem anderen kosten-/lastintensiven Endpunkt im Projekt kein
    // Rate-Limit — ein kompromittierter Account konnte beliebig oft in
    // kurzer Folge parallele Mehrfachabfragen auslösen.
    if (
      !(await checkRateLimit("gdpr-export-self", {
        maxRequests: 5,
        windowSeconds: 3600,
        extraKey: user.id,
      }))
    ) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const admin = createAdminClient();
    const payload = await exportUserData(admin, user.id);

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="meine-daten.json"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: genericErrorMessage(e) }, { status: 500 });
  }
}
