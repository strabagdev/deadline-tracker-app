# Dashboard Analítico: Secciones y propósito

Este dashboard (`/app`) está orientado al análisis y toma de decisiones.
No reemplaza la vista operativa (`/app/operations`), la complementa.

## 1) Encabezado y filtros
- **Tipo de entidad**: limita el análisis a una categoría específica.
- **Búsqueda**: filtra por nombre de entidad o tipo.
- **Objetivo**: acotar el universo antes de leer indicadores y gráficos.

## 2) Tarjetas KPI (resumen rápido)
- **Total entidades**: volumen del conjunto filtrado.
- **Con forecast**: cuántas tienen proyección activa.
- **Vencidas**: entidades con estado crítico.
- **Al día**: entidades en condición saludable.
- **Cobertura**: porcentaje con información proyectada.
- **Objetivo**: entregar contexto ejecutivo en segundos.

## 3) Distribución por estado
- Muestra la proporción de entidades por estado (`Vencido`, `Por vencer`, `Aviso`, `Al día`, `Sin info`).
- Incluye conteo absoluto y porcentaje por estado.
- **Objetivo**: visualizar riesgo relativo y concentración de criticidad.

## 4) Top por tipo de entidad
- Ranking de tipos con mayor cantidad de entidades (según filtros actuales).
- **Objetivo**: detectar en qué tipos se concentra la carga operativa.

## 5) Tendencia próximos 30 días
- Resume cuántos vencimientos proyectados caen por fecha en una ventana de 30 días.
- **Objetivo**: anticipar picos de trabajo y planificar capacidad.

## 6) Contexto
- Muestra referencia de total de entidades en organización y recordatorio de uso:
  - `Dashboard`: análisis.
  - `Operaciones`: ejecución diaria.
- **Objetivo**: reforzar el rol de cada vista y evitar mezclar objetivos.

## Nota de uso recomendada
- Usa este dashboard para decidir **qué priorizar**.
- Usa `Operaciones` para ejecutar **qué hacer ahora** sobre cada entidad.
