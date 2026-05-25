const API_URL = '/api';

const COLORS = [
  '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
  '#1abc9c','#e67e22','#c0392b','#2980b9','#27ae60',
  '#d35400','#8e44ad','#16a085','#f1c40f','#2c3e50',
];

let allCustomers = [];
let map = null;
let layerGroups = {};

// CSV satırını parse et (quoted field'ları destekler)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Sütun adını esnek eşleştirir
function findColIdx(header, keywords) {
  return header.findIndex(h => keywords.some(k => h.includes(k) || k.includes(h)));
}

// Satır dizisinden müşteri listesi oluştur (CSV ve Excel için ortak)
function rowsToCustomers(rows) {
  // Boş satırları temizle
  const cleaned = rows.filter(r => r.some(c => String(c).trim() !== ''));
  if (cleaned.length < 2) {
    showStatus('Dosyada yeterli veri yok (en az 2 satır gerekli)', 'error');
    return null;
  }

  const raw = cleaned[0].map(h => String(h || '').toLowerCase().trim());

  const idIdx    = findColIdx(raw, ['id', 'sıra', 'no']);
  const isimIdx  = findColIdx(raw, ['sipariş sahibi', 'isim', 'ad soyad', 'adsoyad', 'ad', 'name', 'müşteri', 'sahip', 'alıcı']);
  const tel1Idx  = findColIdx(raw, ['sipariş sahibi telefon', 'tel1', 'telefon1', 'telefon 1', 'gsm1', 'cep1', 'telefon', 'tel', 'gsm', 'cep', 'phone']);
  const tel2Idx  = findColIdx(raw, ['teslim edilecek telefon', 'tel2', 'telefon2', 'telefon 2', 'gsm2', 'cep2', 'ev tel', 'sabit', 'iletişim']);
  const adresIdx = findColIdx(raw, ['tesim adresi', 'teslim adresi', 'adresi detayı', 'adres', 'address', 'teslimat', 'açık adres', 'konum', 'mahalle', 'sokak']);

  console.log('Sütun tespiti:', { raw, idIdx, isimIdx, tel1Idx, tel2Idx, adresIdx });

  // Adres sütunu zorunlu
  if (adresIdx === -1) {
    const msg = `Adres sütunu bulunamadı!\n\nDosyadaki sütunlar:\n${raw.map((h, i) => `  ${i}: "${h}"`).join('\n')}\n\nBeklenen anahtar kelimeler: adres, teslim adresi, konum, address`;
    alert(msg);
    showStatus(`Adres sütunu bulunamadı — dosyadaki sütunlar: ${raw.join(' | ')}`, 'error');
    return null;
  }

  const customers = [];
  for (let i = 1; i < cleaned.length; i++) {
    const row = cleaned[i];
    const adres = String(row[adresIdx] || '').trim();
    if (!adres) continue;

    customers.push({
      id: idIdx !== -1 ? parseInt(row[idIdx]) || i : i,
      isim: isimIdx !== -1 ? String(row[isimIdx] || '').trim() : `Müşteri ${i}`,
      tel1: tel1Idx !== -1 ? String(row[tel1Idx] || '').trim() : '',
      tel2: tel2Idx !== -1 ? String(row[tel2Idx] || '').trim() : '',
      adres,
    });
  }

  if (customers.length === 0) {
    showStatus('Adres sütunu boş — hiç kayıt yüklenemedi', 'error');
    return null;
  }

  return customers;
}

function onCustomersLoaded(customers, fileName) {
  // Hata durumunda eski veriyi temizle
  allCustomers = [];
  document.getElementById('optimizeBtn').disabled = true;

  if (!customers || customers.length === 0) return;

  allCustomers = customers;
  window._geocodeDone = false; // yeni dosya = geocoding tekrar gerekebilir

  const uniqueAddresses = new Set(customers.map(c => c.adres)).size;
  const preview = document.getElementById('csvPreview');
  preview.style.display = 'block';
  preview.textContent = `${customers.length} müşteri — ${uniqueAddresses} farklı adres`;

  showStatus(`${customers.length} müşteri yüklendi (${fileName})`, 'success');
  const btn = document.getElementById('optimizeBtn');
  btn.disabled = false;
  btn.textContent = 'Rotaları Optimize Et';
}

// Dosya yükleme — CSV ve Excel destekli
document.getElementById('csvFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  showStatus(`"${file.name}" okunuyor...`, 'loading');

  const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

  if (isExcel) {
    if (typeof XLSX === 'undefined') {
      showStatus('Excel kütüphanesi yüklenemedi. Sayfayı yenileyin veya CSV kullanın.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showStatus('Dosya okunamadı.', 'error');
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        console.log('Excel satır sayısı:', rows.length, '| İlk satır:', rows[0]);
        onCustomersLoaded(rowsToCustomers(rows), file.name);
      } catch (err) {
        showStatus(`Excel okuma hatası: ${err.message}`, 'error');
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onerror = () => showStatus('Dosya okunamadı.', 'error');
    reader.onload = (evt) => {
      try {
        const lines = evt.target.result.split('\n').filter(l => l.trim());
        const rows = lines.map(l => parseCSVLine(l));
        console.log('CSV satır sayısı:', rows.length, '| Başlık:', rows[0]);
        onCustomersLoaded(rowsToCustomers(rows), file.name);
      } catch (err) {
        showStatus(`CSV okuma hatası: ${err.message}`, 'error');
        console.error(err);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }
});

async function runOptimize() {
  if (allCustomers.length === 0) {
    showStatus('Önce dosya yükleyin', 'error');
    return;
  }

  const anadoluGroupSize = parseInt(document.getElementById('anadoluGroupSize').value) || 25;
  const avrupaGroupSize  = parseInt(document.getElementById('avrupaGroupSize').value)  || 20;
  const uniqueCount = new Set(allCustomers.map(c => c.adres)).size;

  // Sonuçları temizle — yeni deneme görünür olsun
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('results').innerHTML = '';

  const btn = document.getElementById('optimizeBtn');
  btn.disabled = true;
  btn.textContent = 'Hesaplanıyor...';

  // Geocoding ilk seferinde uzun sürer, sonrakiler cache'den gelir
  const isFirstRun = !window._geocodeDone;
  const estimatedMin = isFirstRun ? Math.ceil(uniqueCount / 30) : 0;
  showStatus(
    isFirstRun
      ? `Geocoding yapılıyor (${uniqueCount} adres)... ~${estimatedMin} dk sürebilir`
      : `5 farklı dağılım deneniyor, en dengeli seçiliyor...`,
    'loading'
  );

  try {
    const response = await fetch(`${API_URL}/customers/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customers: allCustomers, anadoluGroupSize, avrupaGroupSize, attempts: 5 }),
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Sunucu hatası');

    window._geocodeDone = true;
    window._lastRouteData = data;

    displayResults(data);
    visualizeRoutes(data.routes);
    document.getElementById('exportBtn').style.display = 'block';

    const failNote = data.failedAddresses > 0 ? ` (${data.failedAddresses} adres bulunamadı)` : '';
    showStatus(
      `${data.groups} araç · ${data.uniqueAddresses} durak · ${data.totalCustomers} müşteri${failNote}`,
      'success'
    );
  } catch (err) {
    showStatus(`Hata: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Yeniden Optimize Et';
  }
}

// Optimize et
document.getElementById('optimizeBtn').addEventListener('click', runOptimize);

// Google Maps URL oluştur (optimize edilmiş sırayla)
function buildGoogleMapsUrl(stops) {
  const points = stops.map(s => `${s.latitude},${s.longitude}`);
  return 'https://www.google.com/maps/dir/' + points.join('/');
}

// Sonuçları göster
function displayResults(data) {
  const section = document.getElementById('resultsSection');
  const resultsDiv = document.getElementById('results');
  const titleEl = document.getElementById('resultsTitle');

  section.style.display = 'block';
  titleEl.textContent = `${data.groups} Araç — ${data.totalCustomers} Müşteri`;
  resultsDiv.innerHTML = '';

  // Genel km denge özeti
  const distances = data.routes.map(r => parseFloat(r.totalDistance));
  const maxKm = Math.max(...distances);
  const minKm = Math.min(...distances);
  const avgKm = distances.reduce((a, b) => a + b, 0) / distances.length;
  const balanceRatio = maxKm > 0 ? Math.round(((maxKm - minKm) / maxKm) * 100) : 0;
  const balanceColor = balanceRatio < 20 ? '#137333' : balanceRatio < 35 ? '#b06000' : '#c5221f';

  const summaryDiv = document.createElement('div');
  summaryDiv.style.cssText = 'background:#f8f9fa;border-radius:6px;padding:10px 12px;margin-bottom:16px;font-size:12px;';
  summaryDiv.innerHTML = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;">
      <span>En uzun: <b>${maxKm.toFixed(1)} km</b></span>
      <span>En kısa: <b>${minKm.toFixed(1)} km</b></span>
      <span>Ortalama: <b>${avgKm.toFixed(1)} km</b></span>
      <span style="color:${balanceColor}">Fark: <b>${balanceRatio}%</b></span>
    </div>
  `;
  resultsDiv.appendChild(summaryDiv);

  // Yakaya göre grupla
  const sides = ['Anadolu', 'Avrupa'];
  sides.forEach(side => {
    const sideRoutes = data.routes.filter(r => r.side === side);
    if (sideRoutes.length === 0) return;

    const sideCustomers = sideRoutes.reduce((s, r) => s + r.stops.reduce((a, st) => a + st.customers.length, 0), 0);
    const sideColor = side === 'Anadolu' ? '#c0392b' : '#2980b9';
    const sideEmoji = side === 'Anadolu' ? '🌏' : '🌍';

    const header = document.createElement('div');
    header.style.cssText = `background:${sideColor};color:white;border-radius:6px;padding:8px 14px;margin-bottom:8px;font-weight:700;font-size:14px;`;
    header.textContent = `${sideEmoji} ${side} Yakası — ${sideRoutes.length} araç · ${sideCustomers} müşteri`;
    resultsDiv.appendChild(header);

    sideRoutes.forEach((route) => {
      const color = COLORS[(route.groupId - 1) % COLORS.length];
      const totalCust = route.stops.reduce((s, st) => s + st.customers.length, 0);
      const multiStops = route.stops.filter(st => st.customers.length > 1).length;

      const card = document.createElement('div');
      card.className = 'route-card';

      const stopsHTML = route.stops.map((stop, idx) => {
        const n = stop.customers.length;
        const badge = n > 1
          ? `<span style="background:#e74c3c;color:white;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:6px">${n} kişi</span>`
          : '';

        const customerRows = stop.customers.map(c => `
          <div class="customer-row">
            <span class="customer-name">${c.isim}</span>
            <span class="customer-phones">${[c.tel1, c.tel2].filter(Boolean).join(' / ')}</span>
          </div>
        `).join('');

        return `
          <div class="stop-item">
            <div class="stop-header">
              <div class="stop-order">${idx + 1}</div>
              <div class="stop-address">${stop.adres}${badge}</div>
            </div>
            ${customerRows}
          </div>
        `;
      }).join('');

      const mapsUrl = buildGoogleMapsUrl(route.stops);
      const multiNote = multiStops > 0
        ? ` · <span style="color:#e74c3c">${multiStops} adreste birden fazla kişi</span>`
        : '';

      card.innerHTML = `
        <div class="route-card-header" onclick="toggleRoute(this)">
          <div class="route-title">
            <div class="route-badge" style="background:${color}">${route.groupId}</div>
            <div>
              <div class="route-name">Araç ${route.groupId}</div>
              <div class="route-meta">${totalCust} müşteri · ${route.stopCount} durak · ${route.totalDistance} km${multiNote}</div>
            </div>
          </div>
          <div class="route-toggle">▾</div>
        </div>
        <div class="route-maps-bar">
          <a class="btn-maps" href="${mapsUrl}" target="_blank" onclick="event.stopPropagation()">
            🗺 Google Maps'te Aç
          </a>
        </div>
        <div class="route-stops">
          ${stopsHTML}
        </div>
      `;

      resultsDiv.appendChild(card);
    });

    // Yakalar arası boşluk
    const spacer = document.createElement('div');
    spacer.style.height = '12px';
    resultsDiv.appendChild(spacer);
  });
}

// Rota kartı aç/kapa — .route-stops'ı bul (Maps butonu değil)
function toggleRoute(header) {
  const card = header.closest('.route-card');
  const toggle = header.querySelector('.route-toggle');
  const stops = card.querySelector('.route-stops');
  const isOpen = stops.classList.contains('open');

  toggle.classList.toggle('open', !isOpen);
  stops.classList.toggle('open', !isOpen);
}

// Haritada görselleştir
function visualizeRoutes(routes) {
  if (!map) initMap();

  // Önceki katmanları temizle
  Object.values(layerGroups).forEach(lg => map.removeLayer(lg));
  layerGroups = {};

  const allMarkers = [];
  const legendItems = [];

  routes.forEach((route) => {
    const color = COLORS[(route.groupId - 1) % COLORS.length];
    const lg = L.layerGroup().addTo(map);
    layerGroups[route.groupId] = lg;

    const latlngs = [];

    route.stops.forEach((stop, idx) => {
      const latlng = [stop.latitude, stop.longitude];
      latlngs.push(latlng);
      allMarkers.push(latlng);

      const customerList = stop.customers
        .map(c => `<b>${c.isim}</b><br><small>${[c.tel1, c.tel2].filter(Boolean).join(' / ')}</small>`)
        .join('<hr style="margin:4px 0">');

      const marker = L.circleMarker(latlng, {
        radius: 7,
        fillColor: color,
        color: 'white',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      });

      marker.bindPopup(`
        <div style="min-width:180px">
          <b style="color:${color}">Araç ${route.groupId} · Durak ${idx + 1}</b>
          <div style="font-size:12px;color:#555;margin:4px 0 8px">${stop.adres}</div>
          ${customerList}
        </div>
      `);

      marker.addTo(lg);
    });

    // Rota çizgisi
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color, weight: 2, opacity: 0.6, dashArray: '6,4' }).addTo(lg);
    }

    legendItems.push(`
      <div class="legend-item">
        <div class="legend-dot" style="background:${color}"></div>
        <span>Araç ${route.groupId} · ${route.side || ''} (${route.stopCount} durak)</span>
      </div>
    `);
  });

  // Haritayı tüm noktalara sığdır
  if (allMarkers.length > 0) {
    map.fitBounds(L.latLngBounds(allMarkers).pad(0.1));
  }

  // Lejandı güncelle
  const legend = document.getElementById('mapLegend');
  document.getElementById('legendItems').innerHTML = legendItems.join('');
  legend.classList.add('show');
}

function initMap() {
  map = L.map('map').setView([41.015, 28.979], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);
}

function showStatus(message, type = 'info') {
  const el = document.getElementById('status');
  el.className = `status ${type}`;
  el.innerHTML = type === 'loading'
    ? `<span class="spinner"></span>${message}`
    : message;
}

// Excel export
function exportToExcel() {
  const data = window._lastRouteData;
  if (!data) return;

  const rows = [];

  // Başlık satırı
  rows.push(['Yaka', 'Araç No', 'Durak Sırası', 'Adres', 'Müşteri Adı', 'Tel 1', 'Tel 2']);

  // Yakaya göre grupla: önce Anadolu, sonra Avrupa
  ['Anadolu', 'Avrupa'].forEach(side => {
    const sideRoutes = data.routes.filter(r => r.side === side);
    if (sideRoutes.length === 0) return;

    sideRoutes.forEach(route => {
      // Araç başlık satırı (okunması kolaylaştırır)
      const totalCust = route.stops.reduce((s, st) => s + st.customers.length, 0);
      rows.push([
        `── ${side} Yakası`,
        `Araç ${route.groupId}`,
        `${route.stopCount} durak`,
        `${totalCust} müşteri`,
        `${route.totalDistance} km`,
        '',
        '',
      ]);

      route.stops.forEach(stop => {
        stop.customers.forEach(customer => {
          rows.push([
            side,
            `Araç ${route.groupId}`,
            stop.order,
            stop.adres,
            customer.isim,
            customer.tel1 || '',
            customer.tel2 || '',
          ]);
        });
      });

      // Araçlar arası boş satır
      rows.push(['', '', '', '', '', '', '']);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Sütun genişlikleri
  ws['!cols'] = [
    { wch: 12 },  // Yaka
    { wch: 10 },  // Araç No
    { wch: 12 },  // Durak Sırası
    { wch: 55 },  // Adres
    { wch: 28 },  // Müşteri Adı
    { wch: 16 },  // Tel 1
    { wch: 16 },  // Tel 2
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rotalar');

  const tarih = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
  XLSX.writeFile(wb, `kurban-rotalar-${tarih}.xlsx`);
}

// Başlangıç
initMap();
