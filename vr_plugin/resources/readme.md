# Guía de Desarrollo: Plugin Estereoscópico QGIS a Meta Quest 2

Este documento detalla los pasos, dependencias y arquitectura para desarrollar un plugin híbrido que permita la visualización estereoscópica y vectorización 3D (X, Y, Z) en un Meta Quest 2 conectándose en tiempo real con QGIS y exportable a AutoCAD.

---

## 🛠️ Fase 1: Preparación del Entorno y Dependencias

Para que el sistema funcione, instalaremos dependencias tanto en el entorno de Python de QGIS como en el entorno del visualizador web.

### 1. Dependencias del Servidor (PC / QGIS Python)
QGIS incluye su propio intérprete de Python. Debes instalar estas librerías directamente en la consola de OSGeo4W (el instalador de QGIS) o mediante el entorno de Python de tu sistema si usas Linux/Mac:

*   **FastAPI:** Framework web asíncrono ultrarrápido para manejar las peticiones del visor.
*   **Uvicorn:** Servidor ASGI para ejecutar FastAPI.
*   **Python-SocketIO:** Para habilitar WebSockets bidireccionales y asíncronos en tiempo real.
*   **GDAL/OGR:** (Ya viene nativo en QGIS) Para la conversión de píxeles a coordenadas geográficas (UTM).

**Comando de instalación (Consola OSGeo4W en Windows):**
```bash
pip install fastapi uvicorn python-socketio[asgi]
```

### 2. Dependencias del Visor (Meta Quest 2 Browser / Frontend)
No requiere instalar nada dentro del visor Meta Quest. El visor solo consumirá librerías de JavaScript a través de un navegador web (Meta Quest Browser). Usaremos enlaces CDN para cargarlas directamente en el archivo HTML:

*   **Three.js:** Motor 3D para WebGL y soporte nativo de WebXR.
*   **Socket.IO Client:** Librería de JavaScript para conectar el navegador con nuestro servidor FastAPI.

---

## 🧭 Fase 2: Pasos de Implementación en Orden Cronológico

Sigue este orden estricto de desarrollo para evitar fallos de conectividad o calibración.

### Paso 1: Configuración de Red Local (IP de la PC)
El Meta Quest 2 y tu PC deben estar conectados exactamente a la **misma red Wi-Fi**.
1. Abre la terminal de tu PC (CMD en Windows) y escribe `ipconfig`.
2. Anota tu **Dirección IPv4 local** (Ejemplo: `192.168.1.75`). Esta IP será la que escribirás en el navegador del Quest.

### Paso 2: Crear el Servidor Base (FastAPI + WebSockets)
Antes de meter código dentro de QGIS, crea un script aislado en tu PC llamado `server.py` para probar la conectividad:

```python
from fastapi import FastAPI
import uvicorn
import socketio

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()
asgi_app = socketio.ASGIApp(sio, app)

@sio.event
async def connect(sid, environ):
    print(f"Visor Quest conectado de forma segura. ID: {sid}")

@sio.on('nuevo_punto_3d')
async def handle_punto(sid, data):
    print(f"📍 Recibido desde Quest -> X: {data['x']}, Y: {data['y']}, Z: {data['z']}")

if __name__ == "__main__":
    uvicorn.run(asgi_app, host="0.0.0.0", port=8000)
```
*Ejecútalo en tu terminal con `python server.py`.*

### Paso 3: Crear el Cliente WebXR (Frontend para el Quest)
Crea un archivo `index.html` básico. Este archivo será servido por tu PC. Debe incluir la inicialización de Three.js en modo VR y la conexión por sockets:

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Visor Fotogramétrico VR</title>
    <!-- Importar Three.js y Socket.io -->
    <script src="https://cloudflare.com"></script>
    <script src="https://socket.io"></script>
</head>
<body>
    <script>
        // Cambia por la IP local de tu PC obtenida en el Paso 1
        const socket = io('http://192.168.1.75:8000'); 

        // Configuración básica de Escena 3D y WebXR con Three.js
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true; // ACTIVAR MODO VR NATIVO
        document.body.appendChild(renderer.domElement);

        // Crear el botón de "Entrar en VR" que exige Meta Quest
        import('https://unpkg.com').then((module) => {
            document.body.appendChild(module.VRButton.createButton(renderer));
        });

        // Simulación de envío de datos al presionar el gatillo (Mapeo WebXR)
        renderer.setAnimationLoop((time, frame) => {
            if (frame) {
                const session = frame.session;
                for (let source of session.inputSources) {
                    if (source.gamepad && source.gamepad.buttons[0].pressed) {
                        // Enviar coordenadas simuladas en tiempo real
                        socket.emit('nuevo_punto_3d', { x: 500230.4, y: 2100450.2, z: 1540.8 });
                    }
                }
            }
            renderer.render(scene, camera);
        });
    </script>
</body>
</html>
```

### Paso 4: Pruebas de Enlace (Validación de Conexión)
1. Con el servidor `server.py` corriendo en la PC, colócate el Meta Quest 2.
2. Abre el **Meta Quest Browser**.
3. En la barra de direcciones escribe la IP de tu PC y el puerto (Ejemplo: `http://192.168.1`).
4. Haz clic en el botón **"Enter VR"** en la pantalla del Quest.
5. Presiona el gatillo de tu control y verifica que en la terminal de tu PC aparezcan impresas las coordenadas simuladas instantáneamente.

### Paso 5: Integración del Servidor en el Plugin de QGIS
Una vez validada la red, migra el código del servidor a la estructura oficial de tu plugin de QGIS. Para evitar que FastAPI congele la pantalla de QGIS, debes iniciarlo dentro de un hilo secundario (`threading.Thread`) apuntando a la capa vectorial activa mediante la API de `PyQGIS`.

### Paso 6: Implementación Matemática del Paralaje (Z)
En el código de JavaScript, debes renderizar dos planos texturizados: uno para la foto izquierda asignado a la cámara izquierda de Three.js, y otro para la foto derecha asignado a la cámara derecha.
*   Mapea el Joystick horizontal del control del Quest.
*   Al moverlo, desplaza sutilmente la foto derecha en el eje X.
*   La magnitud de ese desplazamiento en píxeles se multiplica por tu factor de escala fotogramétrica para calcular la **Coordenada Z** real del terreno.

---

## 📐 Fase 3: Preparación de Datos y Exportación a AutoCAD

1. **En QGIS:** Antes de empezar a trabajar en VR, crea un nuevo **GeoPackage** en QGIS con geometría de tipo `LineStringZ` (para curvas de nivel) o `PolygonZ` (para edificaciones). La propiedad **Z** debe estar explícitamente activa.
2. **Durante la sesión:** Cada punto enviado desde el Quest añade un nodo 3D a la capa en edición activa dentro de QGIS.
3. **Exportación:** Una vez finalizada la vectorización en el modelo estereoscópico:
   * Ve a QGIS, haz clic derecho sobre la capa editada.
   * Selecciona **Exportar -> Guardar objetos como...**
   * Elige el formato **AutoCAD DXF**.
   * Asegúrate de marcar la casilla **"Incluir dimensión Z"**. Al abrir el archivo en AutoCAD, tus curvas de nivel y perímetros de edificaciones conservarán sus alturas tridimensionales exactas.

