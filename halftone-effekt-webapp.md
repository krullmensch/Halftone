# Blueprint: Halftone Ink Bleed Web-Tool

## 1. Projektübersicht
Ziel ist die Entwicklung eines interaktiven, Browser-basierten Tools, das Bilder (und perspektivisch Videos) in einen prozeduralen "Halftone Ink Bleed"-Effekt umwandelt. Der Effekt kombiniert ein anpassbares Punktraster (Halftone) mit einem Metaball-Post-Processing, wodurch die Punkte wie flüssige Tinte ineinander verlaufen.

### Tech Stack
* **Frontend / UI:** React (Next.js), um eine reaktive Seitenleiste mit Slidern bereitzustellen.
* **Rendering-Engine:** `p5.js`, eingebunden via `react-p5-wrapper` (oder nativ als Instanz), zur reinen CPU-basierten Bildverarbeitung.

---

## 2. Benutzeroberfläche (UI) & Status-Parameter
Die React-Oberfläche muss folgende Variablen verwalten und in Echtzeit an den p5.js-Canvas übergeben (Props):

### Medien & Setup
* `media`: Das hochgeladene Bild (`.jpg`, `.png`).
* `canvasSize`: Arbeitsauflösung (z.B. 600px - 1000px).

### Halftone-Generierung
* `stepSize`: Abstand der Rasterpunkte (Dichte des Rasters, z.B. 3 bis 20).
* `gridType`: "Regular" (normales Raster) oder "Benday" (jede zweite Zeile ist um `stepSize/2` versetzt).
* `gridAngle`: Stufenlose Drehung des Rasters (z.B. -45° bis 45°).
* `noise`: Displacement-Faktor per Perlin Noise (z.B. 0 bis 20).
* `halftoneThreshold`: Schwellenwert der Bildhelligkeit, ab dem überhaupt Punkte gezeichnet werden.
* `minDotSize` & `maxDotSize`: Minimale und maximale Größe der gezeichneten Geometrie (je nach Bildhelligkeit).
* `cornerRadius`: Abrundung der gezeichneten Vierecke (0 = Quadrate, 50% = Kreise).

### Ink Bleed (Metaball) Effekt
* `inkBleedRadius`: Stärke des Gaußschen Weichzeichners (z.B. 0 bis 10 Pixel).
* `inkThickness`: Schwellenwert für den Cut-off nach dem Blur (z.B. 0.1 bis 0.9, Standard 0.5).

---

## 3. Die Rendering-Pipeline (p5.js Algorithmus)

Der gesamte Effekt wird in der `draw()` Schleife von p5.js berechnet. Um den flüssigen Ink Bleed Effekt zu erzielen, **muss auf einem Offscreen-Buffer (`p5.Graphics`) gezeichnet werden.**

### Schritt 1: Bild-Sampling vorbereiten
* Originalbild in ein p5-Image-Objekt laden.
* `img.loadPixels()` aufrufen, um Zugriff auf das 1D-Pixelarray zu erhalten.

### Schritt 2: Das Raster (Grid) aufbauen
* Zwei verschachtelte `for`-Schleifen iterieren in Sprüngen der `stepSize` über die Breite und Höhe des Canvas.
* **Benday-Logik:** Wenn `gridType === "Benday"`, addiere zu den X-Koordinaten jeder ungeraden Y-Zeile exakt `stepSize / 2`.

### Schritt 3: Koordinaten-Transformation (Rotieren & Rauschen)
Für jeden Rasterpunkt:
* Rotiere die X/Y-Koordinaten um den `gridAngle` um das Zentrum des Canvas (via Sinus/Kosinus-Matrix).
* Wenn `noise > 0`, füge der X- und Y-Koordinate einen Offset hinzu, der durch `p5.noise()` berechnet wird.

### Schritt 4: Helligkeit messen & Mappen
* Rechne die transformierte 2D-Koordinate in den 1D-Index des Originalbild-Arrays um: `index = (floor(x) + floor(y) * img.width) * 4`.
* Berechne die Luminanz (Helligkeit) des Pixels: `(R + G + B) / 3`.
* Wenn Luminanz < `halftoneThreshold`: Mappe die Luminanz proportional auf eine Punktgröße zwischen `minDotSize` und `maxDotSize`.

### Schritt 5: Geometrie in den Buffer zeichnen
* Der Buffer (`pg`) hat initial einen weißen Hintergrund.
* Setze die Füllfarbe auf Schwarz (`pg.fill(0)`).
* Zeichne den Punkt an der korrekten Koordinate. Nutze dafür `pg.rect()` mit dem Parameter `cornerRadius`, um nahtlos zwischen harten Quadraten und runden Kreisen wechseln zu können. (Jeder Punkt muss vorher mit `push`, `translate`, `rotate`, `pop` passend ausgerichtet werden).

### Schritt 6: Post-Processing (The Ink Bleed Magic)
Sobald die gesamte Raster-Geometrie in den Buffer gezeichnet wurde, wende folgende native p5-Filter sequenziell auf den Buffer an:
1. **Faltung:** `pg.filter(BLUR, inkBleedRadius)`. Dies erzeugt graue Auren um die schwarzen Punkte. Wo Punkte nah beieinander liegen, addieren sich die Auren.
2. **Quantisierung:** `pg.filter(THRESHOLD, inkThickness)`. Dies schneidet die Grauwerte hart ab. Die addierten Graubereiche zwischen nahen Punkten überschreiten den Schwellenwert und werden schwarz, wodurch organische, schmelzende Brücken entstehen.

### Schritt 7: Output
Zeichne den fertigen Buffer auf den Haupt-Canvas: `image(pg, 0, 0)`.

---

## 4. Code-Referenz (p5.js Core Logic)
Hier ist das grobe Skelett für die p5.js Instanz, das die Architektur des Post-Processings verdeutlicht:

```javascript
let pg;
let img;

function setup() {
  createCanvas(800, 800);
  pg = createGraphics(width, height);
  pixelDensity(1); // Wichtig für verlässliche Filter-Berechnungen
}

function draw() {
  if (!img) return;
  
  // 1. Buffer reset
  pg.clear();
  pg.background(255);
  pg.fill(0);
  pg.noStroke();
  
  img.loadPixels();
  
  // 2. Halftone Grid berechnen (Pseudo-Code)
  for (let y = 0; y < height; y += stepSize) {
    let bendayOffset = (gridType === 'Benday' && (y / stepSize) % 2 !== 0) ? stepSize / 2 : 0;
    
    for (let x = 0; x < width; x += stepSize) {
      let currentX = x + bendayOffset;
      let currentY = y;
      
      // -> Wende Grid Angle Rotation an
      // -> Wende Noise Displacement an
      // -> Sample Pixel von img an der rotierten Koordinate
      // -> Mappe Luminanz zu dotSize
      
      // Zeichne Geometrie in den Buffer
      pg.push();
      pg.translate(currentX, currentY);
      // Rotiere den Punkt selbst
      pg.rect(-dotSize/2, -dotSize/2, dotSize, dotSize, cornerRadius);
      pg.pop();
    }
  }
  
  // 3. Post-Processing für Metaball Ink Bleed Effekt
  pg.filter(BLUR, inkBleedRadius);
  pg.filter(THRESHOLD, inkThickness);
  
  // 4. Rendern
  background(255);
  image(pg, 0, 0);
  
  noLoop(); // Nur neu rendern, wenn sich React-Props ändern
}