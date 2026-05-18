# 🗺️ Kurban KVS Rota Optimizasyonu

Kurban dağıtımı için **rota optimizasyonu** yapan web uygulaması.

## 📋 Özellikler

- ✅ CSV'den adres yükleme
- ✅ 25'li gruplara clustering
- ✅ Nearest Neighbor algoritması ile rota optimize etme
- ✅ Haversine formülü ile mesafe hesaplama
- ✅ Google Maps Distance Matrix API entegrasyonu
- ✅ İnteraktif harita görselleştirmesi

## 🚀 Kurulum

### Gereksinimler
- Node.js 16+
- npm/yarn
- Google Maps API Key

### Backend Kurulum

```bash
cd backend
npm install
cp .env.example .env
# .env dosyasında GOOGLE_MAPS_API_KEY'i girin

# Development modu
npm run dev

# Production build
npm run build
npm start
```

Server: `http://localhost:5000`

### Frontend Kurulum

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:3000`

## 📊 API Endpoints

### POST /api/optimize
CSV dosyasından adresleri optimize et

```bash
curl -X POST http://localhost:5000/api/optimize \
  -H "Content-Type: application/json" \
  -d '{"csvFile": "data/example-addresses.csv", "groupSize": 25}'
```

**Response:**
```json
{
  "status": "success",
  "totalAddresses": 25,
  "groups": 1,
  "routes": [
    {
      "groupId": 1,
      "addressCount": 25,
      "optimizedRoute": [1, 2, 3, ...],
      "totalDistance": "12.45",
      "addresses": [...]
    }
  ]
}
```

### POST /api/addresses/optimize
Manuel adresleri optimize et

```bash
curl -X POST http://localhost:5000/api/addresses/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "addresses": [
      {
        "id": 1,
        "address": "Üsküdar, Bağlarbaşı",
        "latitude": 41.0259,
        "longitude": 29.0218
      }
    ],
    "groupSize": 25
  }'
```

## 🗂️ Proje Yapısı

```
kurban-kvs-rotalar/
├── backend/
│   ├── src/
│   │   ├── index.ts           # Express app
│   │   ├── routes/api.ts      # API endpoints
│   │   ├── services/
│   │   │   ├── routeOptimizer.ts    # K-Means + Nearest Neighbor
│   │   │   └── googleMapsService.ts # Google Maps integration
│   │   └── utils/
│   │       └── distanceCalculator.ts # Haversine formülü
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   ├── package.json
│   └── index.html
├── data/
│   └── example-addresses.csv  # Örnek veri (Üsküdar Bağlarbaşı)
└── README.md
```

## 🧮 Algoritma Açıklaması

### 1. Clustering (K-Means)
- Adresler koordinatlarına göre 25'li gruplara bölünür
- Her grup coğrafi olarak yakın adresleri içerir

### 2. Rota Optimizasyonu (Nearest Neighbor)
- Her grupta başlangıç noktasından başlar
- Her adımda en yakın ziyaret edilmemiş adrese gider
- O(n²) zaman karmaşıklığında hızlı sonuç verir

### 3. Mesafe Hesaplama
- **Haversine Formülü**: Başlangıçta basit, hızlı
- **Google Maps API**: Daha doğru, gerçek yol mesafeleri

## 📝 Örnek Veri Formatı (CSV)

```csv
id,address,latitude,longitude,notes
1,Üsküdar Bağlarbaşı No:1,41.0259,29.0218,Yakın
2,Üsküdar Bağlarbaşı No:2,41.0265,29.0220,Yakın
...
```

## 🔐 Google Maps API Güvenliği

.env.example dosyasında API Key'inizi girin:
```
GOOGLE_MAPS_API_KEY=AIzaSy...
```

**İpucu:** Üretim ortamında:
- API Key'i HTTP referrer'larla kısıtlayın
- Environment variables kullanın
- Key'i asla public repository'e commit etmeyin

## 🛠️ Geliştirme

### Test CSV'si Oluşturma
```bash
# data/example-addresses.csv zaten hazır
# Kendi CSV'nizi bu formatta oluşturun
```

### Development Debug
```bash
# Backend logs
tail -f /logs/backend.log

# Frontend dev tools
Chrome DevTools açın
```

## 📈 Gelecek Özellikler

- [ ] Google Sheets entegrasyonu
- [ ] Rota haritada visualizasyon
- [ ] Sürücü atama sistemi
- [ ] Tamamlanan rotaları kaydetme
- [ ] İlerleme tracking

## 📞 İletişim

Sorular için huseyinyarali@example.com

---

**Made with ❤️ for Kurban KVS Logistics**
