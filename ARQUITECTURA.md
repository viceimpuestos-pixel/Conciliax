# Conciliax — Arquitectura

Aplicación web de **conciliación bancaria y análisis financiero** (Bancolombia ↔ Auxiliar contable por tercero).

## 1. Decisión de arquitectura

**SPA 100% cliente (browser-only), sin backend.**

| Criterio | Decisión | Razón |
|---|---|---|
| Ejecución | Vite + React 18 + TypeScript | Un solo `npm run dev`. Build estático desplegable en cualquier hosting. |
| Privacidad | Todo el procesamiento ocurre en el navegador | Extractos, NIT y auxiliares contables **nunca salen del equipo**. Cumple el requisito de seguridad sin infraestructura. |
| Estado | Zustand + selectores memoizados | Simple, sin boilerplate, serializable → migrable a persistencia/servidor. |
| Parsing | SheetJS (`xlsx`) | Lee XLSX/XLS/CSV con un único código. |
| Gráficos | Recharts | Interactivo, tooltips, responsive. |
| Export | SheetJS (Excel) + jsPDF/autotable (PDF) | Sin servidor. |
| Pruebas | Vitest | Motor de conciliación probado de forma unitaria. |

### Por qué no un backend (todavía)
El volumen típico (miles de movimientos/mes) se procesa en milisegundos en el cliente. Un backend agrega despliegue, custodia de datos financieros y cumplimiento. La arquitectura **aísla el núcleo** (`src/core`) de React, de modo que ese mismo código TypeScript puede ejecutarse en Node/serverless sin cambios cuando se requiera multiempresa y auditoría centralizada.

## 2. Capas

```
src/
├── core/                    ← LÓGICA PURA (sin React, sin DOM). Testeable y portable a Node.
│   ├── types.ts             Modelo de dominio (BankTx, LedgerTx, Match, ...)
│   ├── normalize/           Normalización: fechas, dinero, texto, NIT, similitud
│   ├── parsing/             Lectura de archivos + detección/mapeo de columnas
│   │   ├── fileReader.ts    XLSX/XLS/CSV → matriz cruda + detección de fila de encabezados
│   │   ├── columnMap.ts     Diccionario de sinónimos + scoring de detección automática
│   │   └── buildDataset.ts  Matriz + mapeo → transacciones normalizadas + validaciones
│   ├── reconciliation/      MOTORES
│   │   ├── config.ts        Pesos, umbrales y tolerancias del motor banco↔contabilidad
│   │   ├── scoring.ts       Score 0-100 multicriterio + razones legibles (banco↔contabilidad)
│   │   ├── engine.ts        Candidatos, asignación global greedy, clasificación (banco↔contabilidad)
│   │   └── dianEngine.ts    Motor DIAN↔auxiliar: bloqueo por NIT, scoring propio (documento pesa más
│   │                        que el valor), pensado para documento-número casi determinístico
│   ├── analytics/           KPIs, agregaciones, alertas, análisis por tercero/cuenta
│   ├── export/              Excel (multi-hoja) y PDF ejecutivo
│   └── demo/                Generador de datos ficticios realistas
├── state/                   Store Zustand + acciones (importación, conciliación manual, bitácora)
├── ui/
│   ├── components/          Reutilizables: KpiCard, DataTable, Badge, Modal, Filters, ...
│   ├── charts/              Envoltorios Recharts con tema corporativo
│   └── pages/               Dashboard, Importar, Conciliación, Terceros, Contable, Alertas, Reportes, Config, Dian
└── styles/                  Design tokens (CSS variables) + estilos base
```

**Regla de dependencias:** `ui → state → core`. `core` no importa nada de `ui`/`state`.

## 3. Flujo de datos

```
Archivo → fileReader → RawSheet ─┐
                                 ├→ ColumnMapping (auto + manual) → buildDataset → Dataset normalizado
Archivo → fileReader → RawSheet ─┘                                                        │
                                                                                          ▼
                                             ReconciliationConfig ──→ engine.reconcile() ──→ ReconciliationResult
                                                                                          │
                            ┌─────────────────────────────────────────────────────────────┤
                            ▼                        ▼                     ▼              ▼
                          KPIs                    Alertas          Análisis tercero    Export
```

## 4. Motor de conciliación (resumen)

1. **Bloqueo (blocking):** por valor absoluto redondeado ± tolerancia → evita O(n²) real.
2. **Scoring por par:** 10 criterios ponderados → 0..100 + lista de razones.
3. **Asignación global:** ordena todos los pares candidatos por score y asigna de forma greedy 1:1 (un movimiento bancario no puede conciliarse dos veces).
4. **Clasificación:** CONCILIADO / PROBABLE / REVISIÓN / NO CONCILIADO / DUPLICADO / DIF. VALOR / DIF. FECHA.
5. **Overlays manuales:** las decisiones del usuario (aceptar, rechazar, vincular, ignorar) se guardan aparte y se re-aplican tras cada re-ejecución.

## 5. Módulo DIAN vs. auxiliar

Segundo flujo de conciliación, independiente del de banco (archivos, mapeo, motor y estado propios en
el store bajo el prefijo `dian*`), pensado para verificar la facturación electrónica:

- **Entrada:** reporte de documentos electrónicos DIAN (Excel/CSV) + un auxiliar contable (cuenta de
  ingresos o de compras/CxP, según lo que se esté conciliando — configurable).
- **Motor (`dianEngine.ts`):** a diferencia del banco, el número de documento es casi determinístico
  (NIT + prefijo/número), así que el bloqueo de candidatos es por NIT (no por rango de valor) y el
  criterio de documento pesa más que el de valor en el score.
- **Documentos rechazados/anulados** se marcan `NO_VALIDO` directamente, sin exigirles soporte contable.
- **Resultado:** facturas DIAN sin registrar, registros contables sin soporte DIAN, y diferencias de
  valor entre ambos — con la misma mecánica de overlays manuales (aceptar/rechazar/vincular/ignorar).

## 6. Preparado para crecer

- **Multiempresa:** el store ya trabaja sobre un objeto `Workspace`; basta anteponer `companyId` y persistir en IndexedDB o API.
- **Otros bancos:** `parsing/columnMap.ts` expone perfiles (`BANK_PROFILES`); agregar un perfil nuevo no toca el motor.
- **Autenticación:** al ser `core` puro, mover `engine.reconcile` a un endpoint es un cambio de una función.
