# EPDS Admin hozzáférés és levelezés telepítése

Az alkalmazás telepítése és újraindítása többé nem inicializálja és nem módosítja a SuperAdmin-fiókot. A már létező helyi SuperAdmin jelszavát a szerverterminálon lehet lecserélni. Az első fiókhoz e-mailes meghívót lehet kiadni. Használj jelszókezelővel generált, egyedi, legalább 16 karakteres, legfeljebb 72 UTF-8 bájtos jelszót.

## Meglévő éles telepítés átállítása

1. A deploy előtt korlátozd a külső hozzáférést az alkalmazás API-jához a proxyn és az esetleges közvetlen backend porton. Várd meg a folyamatban lévő kérések befejezését. Őrizd meg a korábbi proxy- és alkalmazásnaplókat.
2. Telepítsd a javított buildet, és ellenőrizd, hogy minden régi backendpéldány leállt. Várd meg, hogy a javított backend adatbázis-migrációi befejeződjenek, és a readiness ellenőrzés sikeres legyen.
3. A **javított** backend konténerben, az éles adatbázis beállításaival futtasd:

   ```bash
   docker compose exec backend node scripts/superadmin.js rotate
   ```

   Coolifyban a backend szolgáltatás interaktív termináljában:

   ```bash
   node /app/scripts/superadmin.js rotate
   ```

   Ha a Coolify terminál nem biztosít interaktív TTY-t, a szerver termináljáról futtasd:

   ```bash
   docker exec -it <javított-backend-konténer> node /app/scripts/superadmin.js rotate
   ```

   A parancs kétszer kéri az új jelszót, és elrejti a bevitt karaktereket. A jelszócsere és a munkamenetek visszavonása egy tranzakcióban történik. A parancs kiírja az adatbázismotort és siker esetén a visszavont munkamenetek számát. A `rotate` csak a már aktivált helyi SuperAdmin-fiókot módosítja. Ha a régi cím `support@epds.hu`, a parancs alapból ezt használja. Más címnél állítsd be az `EPDS_ADMIN_SUPERADMIN_EMAIL` változót a meglévő fiók címére.
4. Korlátozott hozzáféréssel próbáld ki az új belépést privát böngészőablakban. A korábbi jelszót a rendszernek el kell utasítania, a csere előtt nyitott munkamenetnek pedig ki kell jelentkeznie a következő védett kérés vagy frissítés során. Indítsd újra a javított backendet, és próbáld ki ismét az új és a régi jelszót. A sikeres ellenőrzések után állítsd vissza a normál elérést.
5. A **Users** felületen ellenőrizd, hogy minden SuperAdmin-fiók ismert és jóváhagyott. A megőrzött éles proxy- és alkalmazásnaplókban keresd meg a SuperAdmin-belépéseket és a kiemelt műveleteket, különösen a felhasználók, szerepkörök és tenantok módosításait. Jegyezd fel, mely időszakot fedik le a rendelkezésre álló naplók. Ha máshol is ezt a jelszót használtátok, ott is cseréld. Visszaállításkor olyan buildet használj, amelyből az induláskori jelszófelülírás már ki van véve.

## Új telepítés

1. Hozd létre az adatbázist, majd indítsd el a javított backendet. PostgreSQL esetén előbb alkalmazd az alapsémát a backend könyvtárból az `npm run postgres:schema` paranccsal, a céladatbázis konfigurációjával. Várd meg a sikeres readiness ellenőrzést.
2. A backend környezetében állítsd be az `EPDS_ADMIN_SUPERADMIN_EMAIL` változót a kijelölt címre, és konfiguráld a Graph-levélküldést az alábbi útmutató szerint. A címzett helyi fiókot kap, ezért bármilyen működő postafiók használható.
3. Indítsd el egyszer a meghívást a backend konténerben.

   ```bash
   docker compose exec backend node scripts/superadmin.js invite
   ```

   Coolifyban a backend termináljában futtasd a `node /app/scripts/superadmin.js invite` parancsot. A parancs az első SuperAdmin-fiókot hozza létre függő állapotban. A link 30 percig érvényes és egyszer használható. Lejárat vagy kézbesítési hiba esetén ugyanazzal a címmel futtasd újra a parancsot. Az új link érvényteleníti a korábbit.
4. A levélből állítsd be a jelszót, próbáld ki a belépést, majd indítsd újra a backendet és ellenőrizd ismét. A SuperAdmin jelszó-visszaállítása az üzemeltetői `rotate` paranccsal történik. Az első belépés során a SuperAdminnak kötelező beállítania az autentikátor alkalmazást.

MongoDB-n a jelszócsere tranzakcióképes replica set vagy sharded cluster kapcsolatot igényel. Önálló MongoDB-példányon a parancs hibával leáll a csere helyett. A PostgreSQL-es éles eljáráshoz ez a feltétel nem szükséges.

## Meghívók és jelszó-visszaállítás beállítása

1. A Coolify backend szolgáltatás környezeti változói között az `EPDS_ADMIN_PUBLIC_URL` értéke az alkalmazás éles HTTPS-címe legyen. A levélben szereplő link erre a címre visz. A `MAIL_SENDER_UPN` értéke az Exchange Online feladói postafiók UPN-je.
2. A backend a Graphhoz az `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` és `AZURE_CLIENT_SECRET` értékeket használja. A Microsoft Entra alkalmazásregisztráció **API permissions** oldalán a Microsoft Graph **Application permissions** alól add hozzá a `Mail.Send` jogosultságot, majd hagyd jóvá a **Grant admin consent** gombbal. Az alkalmazásként történő küldéshez nincs szükség redirect URI-ra. A felhasználói Microsoft-bejelentkezés saját redirect URI-beállítása továbbra is szükséges.
3. A változók mentése után telepítsd újra a backendet. SuperAdminként a **Users → Add user** alatt válaszd ki az alkalmazáson belüli tenantot, szerepkört és belépési módot. A mentés azonnal meghívót küld. Microsoft-belépésnél a címzett a meghívott e-mail-címhez tartozó Microsoft-fiókot kapcsolja össze. Jelszavas belépésnél a címzett a meghívó linkjén állítja be a jelszavát.
4. Az első éles ellenőrzéshez használj saját tesztpostafiókot. Nézd meg, hogy megérkezik-e a 72 óráig érvényes meghívó, működik-e az aktiválás, és a megfelelő tenant nyílik-e meg. Jelszavas tesztfiókkal próbáld ki a **Forgot password?** funkciót is. A visszaállító link 30 percig érvényes. Mindkét link egyszer használható. A SuperAdmin jelszavát a fenti terminálparancs kezeli.
5. Sikertelen küldés vagy lejárt meghívó esetén a **Users → Resend invitation** új linket ad. Ha a felület sikeres küldést jelez, de a levél nem érkezik meg, ellenőrizd a levélszemét mappát és az Exchange Message Trace eredményét. A Graph sikeres válasza a kérés befogadását jelzi.

[Microsoft Graph levélküldés](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)

## Kétlépcsős hitelesítés éles telepítése

1. Coolifyban a **backend** futásidejű környezeti változóihoz adj hozzá egy külön, egyszer generált `MFA_ENCRYPTION_KEY` értéket. Az `openssl rand -hex 32` paranccsal generálj kulcsot, és tárold a többi éles titokkal együtt. Minden backendpéldány ugyanazt az értéket használja. A visszaállítható adatbázismentéshez a megfelelő alkalmazáskulcsot is őrizd meg.
2. Az `EPDS_ADMIN_PUBLIC_URL` legyen az éles felület HTTPS-címe. Ha eltér az a pontos HTTPS-origin, amelyről a böngésző a passkeyt használja, add meg a `MFA_WEBAUTHN_ORIGIN` változóban, például `https://admin.example.com`. A passkey a gazdagépnévhez kötődik. Domainváltáskor a felhasználók be tudnak lépni az autentikátor alkalmazással, majd az új címen rögzíthetnek új passkeyt.
3. Telepítsd együtt az új backendet és frontendet. A backend PostgreSQL-en induláskor automatikusan alkalmazza a `016_local_mfa` migrációt. A helyi SuperAdmin, Admin és Finance fiókok korábbi, csak jelszóval létrejött munkamenetei a következő hitelesített kérésnél új belépést igényelnek.
4. Ha ez az első éles kiadás a kódból felülírt SuperAdmin-jelszó javítása óta, tartsd zárva a külső elérést a régi konténerek leállítása, a jelszócsere és a SuperAdmin saját TOTP-beállítása alatt. Ha bármely meglévő SuperAdmin-hitelesítő eszköz eredete bizonytalan, a jelszócserét a `--reset-mfa` kapcsolóval végezd, és regisztráld újra a fiókot a visszanyitás előtt.
5. Korlátozott hozzáféréssel ellenőrizd a helyi SuperAdmin, Admin és Finance belépést. Jelszó után a beállítás nélküli fióknál QR-kód jelenik meg. Beállítás után próbáld ki a TOTP-t, a passkeyt és az egyszer használható helyreállító kódot. Külön tesztfiókkal ellenőrizd a Microsoft-belépést és azt is, hogy a normál User ajánlójának elutasítása mentés után másik böngészőben is érvényes.

### SuperAdmin helyreállítása

Ha elérhető a passkey vagy egy helyreállító kód, a SuperAdmin ezek egyikével beléphet, majd **Profile & security → Replace authenticator app** alatt új eszközt állíthat be. Ha minden belépési eszköz elveszett, előbb igazold a fiók tulajdonosát, és korlátozd az API elérését. Coolify backendterminálban futtasd az alábbi parancsot.

```bash
node /app/scripts/superadmin.js rotate --reset-mfa
```

A parancs a jelszócserével és a munkamenetek visszavonásával egy tranzakcióban törli a regisztrált hitelesítési módszereket. A következő belépéskor állítsd be az új autentikátort, és mentsd az új helyreállító kódokat. Ezután ellenőrizd az új belépést, majd állítsd vissza a külső elérést. A jelszócsere önmagában megőrzi az MFA-beállításokat.

Más helyi fióknál ugyanezt az üzemeltetői eljárást használd, ha az identitást ellenőriztétek és minden hitelesítési mód elveszett.

```bash
node /app/scripts/superadmin.js reset-user-mfa person@example.com
```

A terminál kéri az új jelszót, amelyet jóváhagyott csatornán adj át a fiók igazolt tulajdonosának. Jegyezd fel az érintett fiókot, az időpontot és a visszaállítás okát. Admin és Finance fióknál a következő belépés újra kéri az autentikátor beállítását. Normál User a profiljában aktiválhatja újra.

### Helyreállítás a Users táblázatból

A SuperAdmin a helyi, aktivált felhasználó sorában a **Start account recovery** művelettel indíthat helyreállítást. A tulajdonos ellenőrzése után erősítsd meg a küldést a párbeszédablakban. A rendszer a fiókhoz rögzített címre küld egy 30 percig érvényes, egyszer használható linket. Az új jelszó mentésekor egy tranzakcióban törli a korábbi MFA-eszközöket és visszavonja a munkameneteket. A levélküldéshez működő Graph-konfiguráció, MongoDB-n pedig tranzakcióképes adatbázis szükséges. A SuperAdmin saját fiókjának helyreállítására a terminálos eljárás szolgál.

## Biztonsági audit és észlelés

- Az alkalmazás HTTP-naplója útvonalmintát tartalmaz, például `/inboxes/:token`. A frontend Nginx hozzáférési naplója metódust, státuszt, méretet és időzítést rögzít. A Coolify előtti Traefik vagy egyéb külső proxy hozzáférési naplóiban külön kapcsold ki a nyers útvonalak és query paraméterek rögzítését. A már rögzített webhook URL-ek tokenjeit kezeld kikerült hitelesítő adatként.
- A backend a `security_audit_events` táblába, illetve MongoDB-gyűjteménybe ír, és a `security-audit` JSON-eseményeket a konténer standard kimenetére is elküldi. PostgreSQL-en a `017_security_audit` migráció megakadályozza az auditrekordok normál UPDATE, DELETE és TRUNCATE műveleteit.
- Élesben az auditobjektumok tulajdonosa külön adatbázis-üzemeltetői szerepkör legyen. A backend szerepköre kapjon INSERT jogot a PostgreSQL-táblára vagy a MongoDB-gyűjteményre, az ellenőrző szerepkör pedig külön olvasási jogot. A PostgreSQL-migráció fusson le a tulajdonosváltás előtt. Az adatbázis-tulajdonos és infrastruktúra-adminisztrátor elleni védelemhez irányítsd a JSON-eseményeket külön üzemeltetett, csak hozzáfűzést engedő naplógyűjtőbe.
- Riasztásnak használd a `security-audit-error` eseményt adatbázisba írási hibánál, és a `security-audit` eseményeket a privilegizált szerepkörváltások, exportok és helyreállítások figyelésére. Az alkalmazás a HTTP-műveletek eredménye után rögzíti az eseményt.
- Átadáskor próbálj szerepkörváltást, munkatábla-exportot, archiválást és számlázási státuszváltást egy teszttenantban. Ellenőrizd az UTC időpontot, az operátor- és tenantazonosítót, a célrekordot és a változás előtti és utáni értékeket. Ellenőrizd, hogy a webhook URL tokenje egyik hozzáférési naplóban sem jelenik meg.
