function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not make the demo letter."));
          return;
        }
        resolve(new File([blob], name, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  });
}

function drawLetter(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#fffbf4";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#1b3a2f";
  ctx.fillRect(0, 0, width, 108);
  ctx.fillStyle = "#c4a35a";
  ctx.fillRect(0, 108, width, 6);

  ctx.fillStyle = "#fffbf4";
  ctx.font = "700 30px Georgia, serif";
  ctx.fillText("Riverside Borough Council", 56, 52);
  ctx.font = "500 15px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText("Revenues  ·  Civic Centre  ·  RV1 2AA", 56, 82);

  ctx.fillStyle = "#1b1914";
  ctx.font = "700 44px Georgia, serif";
  ctx.fillText("Council Tax Bill", 56, 186);

  ctx.fillStyle = "#5f594e";
  ctx.font = "600 17px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText("Tax year 2026–27", 56, 218);

  ctx.fillStyle = "#1b1914";
  ctx.font = "600 17px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText("A. Householder", 56, 274);
  ctx.font = "500 16px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText("14 Maple Street", 56, 300);
  ctx.fillText("Riverside  ·  RV1 4MP", 56, 324);

  ctx.fillStyle = "#e6f2ea";
  ctx.fillRect(56, 368, width - 112, 132);
  ctx.fillStyle = "#1b3a2f";
  ctx.font = "700 13px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText("AMOUNT DUE FOR THE YEAR", 80, 404);
  ctx.font = "700 52px Georgia, serif";
  ctx.fillText("£1,842.36", 80, 466);

  const rows: Array<[string, string]> = [
    ["Band", "D"],
    ["Account reference", "CT-88421-26"],
    ["Date of issue", "18 March 2026"],
    ["First instalment", "1 April 2026"],
    ["Property", "14 Maple Street, RV1 4MP"],
  ];

  let y = 548;
  ctx.font = "500 16px 'Plus Jakarta Sans', system-ui, sans-serif";
  rows.forEach(([label, value], index) => {
    if (index % 2 === 0) {
      ctx.fillStyle = "#f3eee4";
      ctx.fillRect(56, y - 26, width - 112, 44);
    }
    ctx.fillStyle = "#5f594e";
    ctx.fillText(label, 80, y);
    ctx.fillStyle = "#1b1914";
    ctx.fillText(value, 340, y);
    y += 44;
  });

  ctx.fillStyle = "#8a8376";
  ctx.font = "500 13px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText("Sample letter for the ScannedOnArrival demo. Not a real bill.", 56, height - 48);
}

function drawDeskPhoto(letter: HTMLCanvasElement): HTMLCanvasElement {
  const desk = document.createElement("canvas");
  desk.width = 1100;
  desk.height = 1460;
  const ctx = desk.getContext("2d");
  if (!ctx) return letter;

  const wood = ctx.createLinearGradient(0, 0, desk.width, desk.height);
  wood.addColorStop(0, "#6f4c2d");
  wood.addColorStop(0.45, "#4d331f");
  wood.addColorStop(1, "#352214");
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, desk.width, desk.height);

  ctx.strokeStyle = "rgba(255, 220, 160, 0.07)";
  ctx.lineWidth = 2;
  for (let y = 0; y < desk.height; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(desk.width, y + 10);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(desk.width / 2 + 18, desk.height / 2 + 10);
  ctx.rotate(-0.065);
  ctx.shadowColor = "rgba(0, 0, 0, 0.42)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 16;
  const width = 760;
  const height = 1076;
  ctx.drawImage(letter, -width / 2, -height / 2, width, height);
  ctx.restore();

  return desk;
}

export async function makeDemoLetterScenes(): Promise<{ desk: File; clean: File }> {
  const letter = document.createElement("canvas");
  letter.width = 900;
  letter.height = 1272;
  const ctx = letter.getContext("2d");
  if (!ctx) throw new Error("Could not draw the demo letter.");
  drawLetter(ctx, letter.width, letter.height);

  const desk = drawDeskPhoto(letter);
  const [deskFile, cleanFile] = await Promise.all([
    canvasToFile(desk, "demo-desk.jpg"),
    canvasToFile(letter, "council-tax-demo.jpg"),
  ]);
  return { desk: deskFile, clean: cleanFile };
}
