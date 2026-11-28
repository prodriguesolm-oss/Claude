// Redimensiona fotos no próprio aparelho antes de gravar (economiza espaço e mantém o app leve).

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler esta imagem.')); };
    img.src = url;
  });
}

function scaled(img, max, quality) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

function square(img, size, quality) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const side = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL('image/jpeg', quality);
}

/** -> { full: dataURL (até 1280px), thumb: dataURL (quadrado 192px) } */
export async function processPhoto(file) {
  const img = await loadImage(file);
  return { full: scaled(img, 1280, 0.82), thumb: square(img, 192, 0.74) };
}
