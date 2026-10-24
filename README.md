# Stage OSC

**Stage OSC** es una aplicación de escritorio de alto rendimiento y ultra-baja latencia construida con **Electron** y **Node.js**, diseñada específicamente para convertir dispositivos táctiles con Windows (como una Lenovo Yoga L13 en modo carpa/tablet) en una **superficie de control remoto por red UDP (OSC / MIDI por IP)** para **REAPER** y otros DAWs.

---

## Características Principales

* **Multitouch Real e Independiente:** Permite mover múltiples faders, girar knobs y pulsar botones o toggles simultáneamente sin que Windows interfiera con gestos táctiles.
* **Ruteo Flexible y Universal:** 
  * Mensajes **MIDI CC (`0–127`)** en canales `1–16`.
  * **Notas MIDI** con modos continuos, *Gate* táctil y barridos (*Glissando*).
  * **Pitch Bend** y **Program Change**.
  * **Rutas OSC Personalizadas** (compatibles con el mezclador y parámetros de REAPER en formato Float o Int).
* **Organización por Escenas y Páginas:** Crea tantas escenas como necesites y organiza tus controles en múltiples páginas con pestañas de acceso rápido.
* **Interfaz Limpia en Modo Edición:** Arrastre libre de controles por toda el área de trabajo con soporte de imán de cuadrícula (*Snap*), redimensionado dinámico y **menú contextual por clic derecho (`⚙ Configurar`)** para mantener la pantalla despejada.
* **Botones Toggle con Feedback LED:** Interruptores ON/OFF de estado con indicador luminoso, textos personalizados y retención de estado.
* **Comprobación de Seguridad y Conectividad:** Botón *Panic* integrado para apagar notas colgadas en todos los canales y monitor de transmisión en vivo.

---

## Estructura del Proyecto

```text
OSC_windows/
├── package.json
├── main.js
├── preload.js
└── src/
    ├── index.html
    ├── styles.css
    └── app.js
