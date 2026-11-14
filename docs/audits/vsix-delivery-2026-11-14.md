# Auditoria de entrega del VSIX - 2026-11-14

## Conclusion y alcance

Se audita la version 0.5.0 de la PR #15, commit funcional
64fd247992614956adf55bab9017c9040d809041. No se implementan correcciones
funcionales en esta auditoria, conforme a la instruccion del usuario.

**El codigo funcional esta en el VSIX; no se ha encontrado una reparacion que
necesite archivos personales, scripts de desarrollo o cambios manuales exclusivos
del ordenador del autor.** Los auxiliares y ajustes locales se crean desde el
codigo empaquetado. Esto no equivale a garantizar funcionamiento perfecto en
cualquier ordenador solo con instalar el VSIX: existen requisitos externos y
limites de verificacion que deben resolverse o aceptarse expresamente.

## Prueba real desde el artefacto

- VSIX reconstruido desde la fuente; su verificador de identidad, recursos y
  ausencia de archivos locales sensibles aprueba.
- 21 archivos de codigo/configuracion empaquetados inspeccionados: ninguna ruta
  personal C:/Users/macor, referencia a .agents/skills o Desktop/GitHub en ellos.
  No hay dependencias npm de produccion pendientes de instalar.
- Instalacion mediante CLI del VSIX en un directorio de extensiones y perfil
  aislados. La extension del producto se carga desde esa instalacion, **sin**
  extensionDevelopmentPath al repositorio del producto. Se utiliza la extension
  oficial de Codex 26.1111.21308 ya disponible como requisito externo controlado.
- CODEX_HOME inicialmente vacio, sin claves, configuracion, catalogos previos ni
  auxiliares; otra prueba usa tambien un segundo perfil vacio. Se eliminan del
  entorno heredado CODEX_SWITCH_BINDING, claves API, PYTHONPATH, PYTHONHOME y
  NODE_PATH. No se reutiliza el estado de la instalacion habitual.
- Resultado del host real Windows x64: openai, phase=verified, propietario del
  proceso correcto, version0.5.0 y ruta de carga dentro del directorio aislado de
  extensiones. Se genera automaticamente el bootstrap Windows y el launcher
  Python; este ultimo coincide byte a byte con la fuente del VSIX.
- Backend ejecutado exclusivamente desde los archivos extraidos del VSIX con
  Python -S (sin site-packages): los nueve providers API inicializan su estado sin
  claves. Se despliegan automaticamente helper de credenciales, fachada nativa,
  catalogo DeepSeek y cliente Linux incluido. No hay llamadas de inferencia.
- SHA256 del paquete auditado:
  05894f8c0d85a59310a4d4914113e52a7510cdfec5d3c4733e5148582c7821d8.
- Sin Computer Use, sin modificaciones de la extension oficial y sin cambios en
  configuracion, credenciales o runtime de la instalacion habitual del usuario.

## Cobertura de funcionalidades

| Funcionalidad | Entrega/arranque desde VSIX | Evidencia y limites |
| --- | --- | --- |
| Sidebar, tema, iconos, layouts estrecho/ancho | HTML/CSS/JS y SVG locales incluidos | DOM/layout y presencia de recursos; no revision visual nueva |
| Lista, orden, visibilidad y provider obligatorio | Motor y estado VS Code incluidos | Tests del bucle host/webview; cancela solicitudes ocultas |
| Python/backend y CODEX_HOME | bridge y modulos incluidos, rutas dinamicas | Arranque empaquetado limpio; Python externo requerido |
| Claves: entrada, validacion, eliminacion y aislamiento | Dialogos y stores incluidos | Tests nativos OS con identidades sinteticas; requiere vault disponible |
| ChatGPT: autenticacion existente, plan, uso, resets | Cliente app-server y normalizador incluidos | Cuenta existente requerida; protocolo mock/nativo, no cuenta real en prueba limpia |
| Nueve API providers y endpoints regionales | Definiciones, validadores y adaptadores incluidos | Estados limpios y contratos mock; no inferencia real de todos los servicios |
| Catalogos y capacidades, fallback, busqueda y filtros OpenRouter | Motor, filtros y catalogo inicial incluidos | APIs externas; cache OpenAI opcional, no requisito oculto |
| Test de modelo Responses/tools | Implementacion incluida | Es una accion potencialmente facturable del usuario; no se ejecuta en auditoria |
| Balance y cuotas fiables, alertas por umbral | Motor, tracker y renderer incluidos | Solo proveedores con metricas soportadas; tests con respuestas sinteticas |
| Sync manual/periodico, estado atomico y cancelaciones | Implementacion incluida | Tests existentes; red/cuentas/servicios son requisitos externos |
| Provider/modelo independiente por workspace | Identidad, archivos de estado y overrides incluidos | Prueba limpia y probes nativos previos; no procede de un TOML personal copiado |
| Launcher, confirmacion, recarga y chat nuevo | Python y C# incluidos; ajustes generados automaticamente | Bootstrap Windows compilado al arrancar; compilador externo requerido |
| Selected y ultimo modelo del selector nativo | Observador y persistencia incluidos | Probes reales anteriores y tests; solo cambios aceptados/proveedor identificado |
| Migracion de configuracion antigua | Codigo de backups/restauracion incluido | Tests con datos sinteticos; instalacion limpia no necesita historial previo |
| Recuperacion de ejecutable personalizado | Codigo/comando incluidos | No empaqueta una ruta del autor; requiere Codex instalado o CLI compatible |
| Actualizacion/desactivacion/desinstalacion | Actualizaciones de auxiliares incluidas | Limite real: desactivar/quitar requiere limpiar cliExecutable manualmente |
| Construccion y publicacion | Workflows/scripts versionados | PR0.5.0 aun no fusionada: no confundir VSIX de prueba con release publicada |

## Reservas que impiden prometer VSIX solo / cualquier usuario

1. **Python3.11+ no esta incluido ni se instala automaticamente.** Se usa python o
   python3 del sistema, o codexSwitch.pythonPath. La maquina de desarrollo y CI
   ya lo tienen. Es un requisito documentado, no un archivo funcional omitido,
   pero un usuario que solo instale el VSIX puede encontrarse sin backend.
2. **El bootstrap Windows no viene compilado.** Viene el C# y se invoca csc.exe
   del .NET Framework del sistema. Falta de compilador/librerias, restricciones
   de ejecucion o un filesystem sin hardlinks impiden crear el launcher. CI lo
   tiene disponible; esta auditoria no certifica todas las instalaciones Windows.
3. **Se necesitan Codex, VS Code desktop compatible y un workspace de confianza.**
   La extension no declara una dependencia que instale Codex automaticamente.
   Linux necesita D-Bus y Secret Service; macOS/Windows necesitan sus servicios
   nativos disponibles. Cuentas, claves, permisos, saldo y red son del usuario.
4. **Desactivacion/desinstalacion no restaura automaticamente cliExecutable.**
   La documentacion pide borrarlo de settings. Si queda apuntando al launcher
   gestionado, este no obtiene una vinculacion nueva y Codex puede no arrancar.
   No es un ajuste secreto del autor, pero la recuperacion no es completamente
   automatica y merece estudiar su solucion antes de afirmar ciclo completo.
5. **Compatibilidad externa y verificacion parcial.** Se comprueba el cliente
   oficial concreto disponible; se depende de su ajuste de ejecutable y de los
   metodos/formatos de app-server. La inferencia de los ocho proveedores nuevos no
   esta verificada con claves reales. Los tests mock no certifican cada modelo,
   ruta, herramienta, streaming, plan comercial o actualizacion futura.
6. **CI no instala y arranca el VSIX limpio en toda la matriz.** Ejecuta tests
   desde el checkout y empaqueta. La prueba real de artefacto limpio de esta
   auditoria es Windows x64. No se certifica por ello instalacion limpia en todos
   los Mac/Linux/ARM ni el uso remoto SSH/WSL/contenedores; el producto es UI local.

Estas reservas no se corrigen en esta tarea. Incluir un runtime Python y un
bootstrap Windows precompilado, mejorar la restauracion al retirar la extension,
la deteccion/declaracion de requisitos y la matriz de instalacion limpia requiere
estudiar distribucion, licencias, plataformas y comportamiento con el usuario.

## Comprobacion adicional del empaquetado de release

El workflow de release invoca vsce directamente y no usa el flag de activacion
estrella del script npm. Se investigo como posible irregularidad. Reproducido con
stdin vacio y los argumentos del workflow: exit0, sin pregunta interactiva,
artefacto generado, verificador aprobado y contenido equivalente al paquete de
npm. **No se presenta como un fallo confirmado de publicacion.** Es una diferencia
de comandos a vigilar, no un arreglo funcional pendiente demostrado.

## Decision solicitada

La condicion obligatoria queda en docs/decisions/project.md: ninguna funcionalidad
puede depender de reparaciones manuales del desarrollador fuera del VSIX. Esta
condicion se verifica positivamente en la prueba limpia bajo los requisitos
indicados. No se certifica funcionamiento universal. El usuario decide si esos
requisitos siguen siendo aceptables o si se estudia un paquete mas autocontenido;
no se han implementado soluciones por anticipado.
