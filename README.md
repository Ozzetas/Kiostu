# Kiosco — Gestión Local de Stock y Cuentas Corrientes (Offline-First)

Aplicación móvil nativa construida con **React Native + Expo (TypeScript estricto)** y arquitectura limpia (**Clean Architecture**), orientada a llevar inventario por unidad o peso (gramos), ventas al contado/fiado con precio histórico congelado y resguardo de privacidad local.

## Stack Técnico

- **Framework:** React Native `0.88.1` + Expo SDK `~58` (Expo Router con `typedRoutes`)
- **Lenguaje:** TypeScript `~6` (`strict`, `noUncheckedIndexedAccess`)
- **Persistencia:** SQLite local (`expo-sqlite` en modo WAL, esquema 3FN en `kiosco_ledger.db`)
- **Validación:** Zod `^4` en frontera de casos de uso y almacenamiento seguro
- **Seguridad:** `expo-secure-store` (iOS Keychain / Android Keystore), `expo-local-authentication` (Face ID), `expo-crypto` (SHA-256 con salt + UUID v4)
- **Medios:** `expo-image-picker`, `expo-image-manipulator` (íconos 300×300), `expo-file-system`

---

## Comandos Diarios (Git Bash en VS Code)

### 1. Levantar la app en el iPhone (Expo Go)
```bash
# Arranque estándar (mismo Wi-Fi)
npx expo start

# Arranque limpiando caché de Metro (usar si agregás rutas/modales o algo queda viejo)
npx expo start --clear

# Arranque por túnel HTTPS (si falla la red local o el Firewall de Windows)
npx expo start --tunnel
```
> **Atajos en Metro:** `r` recarga la app en el celular · `Ctrl + C` frena el servidor.  
> **En el iPhone:** agitá el teléfono para abrir el menú de desarrollo de Expo Go.

### 2. Verificación estricta de TypeScript (correr siempre antes de commitear)
```bash
npx tsc --noEmit
```
> Debe terminar sin imprimir nada (código de salida `0`).  
> Si agregaste una ruta nueva en `app/` y `tsc` no la reconoce, borrá `.expo/types` y levantá Metro una vez para regenerar los tipos:
> ```bash
> rm -rf .expo/types && npx expo start --clear
> ```

### 3. Instalar nuevas dependencias
Usar siempre `npx expo install` (nunca `npm install` directo para módulos nativos) para fijar versiones compatibles con el SDK:
```bash
npx expo install <nombre-del-paquete>
```

### 4. Validar `app.json` y plugins nativos
```bash
npx expo config --type introspect > /dev/null && echo "app.json OK"
```

---

## Flujo de Trabajo con Git

1. Abrir rama de feature desde `main`:
   ```bash
   git checkout main
   git checkout -b feat/<nombre-de-fase>
   ```
2. Commitear avances atómicos (Conventional Commits):
   ```bash
   git status
   git add <archivos>
   git commit -m "feat(modulo): descripcion breve en ingles"
   git push
   ```
3. Integrar rama cerrada en `main` y limpiar:
   ```bash
   git checkout main
   git merge feat/<nombre-de-fase>
   git push
   git branch -d feat/<nombre-de-fase>
   git push origin --delete feat/<nombre-de-fase>
   ```

---

## Notas de Desarrollo y Seguridad

- **Olvidé la contraseña en pruebas:** En modo desarrollo (`__DEV__`), la pantalla de bloqueo y la pestaña **Ajustes** muestran un botón para limpiar el Keychain y volver a `"Blindá tu Kiosco"` sin perder los datos de SQLite. Ese botón no existe en builds de producción.
- **Face ID en Expo Go vs. EAS Build:** Expo Go en iOS no carga el `Info.plist` personalizado de `app.json`, por lo que Face ID degrada automáticamente a contraseña. El desbloqueo facial nativo se prueba en el binario compilado con **EAS Build** (Fase 7).
- **Borrado de emergencia (Panic Wipe):** Ingresar la clave secundaria en la pantalla de bloqueo cierra SQLite, borra físicamente `.db/.wal/.shm`, las imágenes locales y las cachés de cámara/recorte, y abre la app vacía sin alertas.

---

## Arquitectura de Capas

```text
app/                  # Rutas y pantallas Expo Router ((tabs)/ y modals/)
src/
  core/               # Errores tipados, Logger JSON, dinero en centavos, crypto y unidades
  domain/             # Entidades estrictas y contratos de repositorios/servicios (DIP)
  application/        # Casos de uso transaccionales y servicios (SessionPolicy, EmergencyWipe, Backup)
  data/               # Implementaciones SQLite, Keychain, Face ID e ImageStorageService
  presentation/       # Composition Root (DI), tokens de diseño, hooks y componentes UI
```

---

## Estado del Plan de Desarrollo

- [x] **Fase 0:** Setup Expo + TypeScript estricto + conexión Expo Go
- [x] **Fase 1:** Core monetario en centavos, errores tipados, Logger y SQLite 3FN
- [x] **Fase 2:** Keychain, Face ID, ventana de sesión (5 min) y Panic Wipe físico
- [x] **Fase 3:** Repositorios ACID y casos de uso de stock, ventas/fiado y pagos
- [x] **Fase 4:** Gestión local de imágenes 300×300 (cámara, galería y URL)
- [ ] **Fase 5:** Interfaz táctil Bento POS, historial con anulación, cuentas corrientes y ajustes *(en validación final)*
- [ ] **Fase 6:** Backup y Restauración portable (`BackupFacade.ts`)
- [ ] **Fase 7:** QA de casos límite, compilación nativa con EAS Build y distribución