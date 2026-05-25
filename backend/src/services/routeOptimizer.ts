import { haversineDistance } from '../utils/distanceCalculator';

interface Stop {
  id: number;
  latitude: number;
  longitude: number;
  [key: string]: any;
}

interface RouteGroup {
  groupId: number;
  addresses: Stop[];
  optimizedRoute: number[];
  totalDistance: number;
  side?: 'Anadolu' | 'Avrupa';
}

// --- Yardımcı fonksiyonlar ---

// Bir duraktaki müşteri sayısı (aynı adresteki tüm müşteriler)
function stopCustomerCount(stop: Stop): number {
  return Array.isArray(stop.customers) ? Math.max(1, stop.customers.length) : 1;
}

// Kümedeki toplam müşteri sayısı (gruplama limiti için kullanılır)
function totalCustomers(stops: Stop[]): number {
  return stops.reduce((sum, s) => sum + stopCustomerCount(s), 0);
}

function centroid(stops: Stop[]): { lat: number; lng: number } {
  return {
    lat: stops.reduce((s, a) => s + a.latitude, 0) / stops.length,
    lng: stops.reduce((s, a) => s + a.longitude, 0) / stops.length,
  };
}

function maxRadiusKm(stops: Stop[]): number {
  if (stops.length === 0) return 0;
  const c = centroid(stops);
  return Math.max(...stops.map(s =>
    haversineDistance(s.latitude, s.longitude, c.lat, c.lng)
  ));
}

// Kümedeki en uzak iki nokta arası mesafe (çap)
function clusterDiameter(stops: Stop[]): number {
  let max = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const d = haversineDistance(stops[i].latitude, stops[i].longitude, stops[j].latitude, stops[j].longitude);
      if (d > max) max = d;
    }
  }
  return max;
}

// Coğrafi olarak sıkışık küme mi? (aynı mahalle/bölge, yarıçap ≤ 2km)
function isTight(stops: Stop[]): boolean {
  return maxRadiusKm(stops) <= 2.0;
}

// Küme mantıklı mı? Çap > MAX_DIAMETER_KM ise çok geniş alana yayılmış demektir
const MAX_DIAMETER_KM = 8;

// --- Boğaz geçiş tespiti (çok noktalı sınır çizgisi) ---
// Boğaz tek bir doğru değil: güneyde dar ve batıda, Arnavutköy/Çengelköy
// seviyesinde ani açılıp kuzeydoğuya dönüyor. Basit bir doğru Ortaköy,
// Bebek, Arnavutköy gibi Avrupa kıyısı mahallelerini yanlış yakaya atar.
// Her nokta Boğaz'ın orta çizgisini (iki kıyının ortası) temsil eder.
const BOSPHORUS_MIDLINE: Array<[number, number]> = [
  [40.85, 28.975],  // Marmara (Kadıköy güneyi)
  [41.00, 28.993],  // Haydarpaşa / Sarayburnu
  [41.04, 29.008],  // Beşiktaş / Üsküdar (dar kesim, ~1 km)
  [41.048, 29.047], // Arnavutköy / Çengelköy (geniş kesim, ~2.5 km)
  [41.075, 29.050], // Bebek / Kandilli
  [41.09, 29.063],  // Rumeli Hisarı / Anadolu Hisarı
  [41.15, 29.090],  // Sarıyer / Beykoz
  [41.23, 29.145],  // Karadeniz girişi
];

function bosphorusBoundaryLng(lat: number): number {
  const pts = BOSPHORUS_MIDLINE;
  if (lat <= pts[0][0]) return pts[0][1];
  if (lat >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    if (lat >= pts[i][0] && lat <= pts[i + 1][0]) {
      const t = (lat - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
    }
  }
  return pts[0][1];
}

function isAsianSide(lat: number, lng: number): boolean {
  return lng > bosphorusBoundaryLng(lat);
}

const BOSPHORUS_PENALTY_KM = 30;

function effectiveDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const base = haversineDistance(lat1, lng1, lat2, lng2);
  return isAsianSide(lat1, lng1) !== isAsianSide(lat2, lng2) ? base + BOSPHORUS_PENALTY_KM : base;
}

// --- Depot (başlangıç noktası) ---
interface Depot { lat: number; lng: number; }

// --- Nearest Neighbor rota optimizasyonu ---

function nearestNeighborRoute(stops: Stop[], depot?: Depot): { route: number[]; distance: number } {
  if (stops.length === 0) return { route: [], distance: 0 };
  if (stops.length === 1) return { route: [stops[0].id], distance: 0 };

  // Depot varsa ona en yakın duraktan başla, yoksa merkeze en uzak noktadan
  let startIdx = 0;
  if (depot) {
    let minDist = Infinity;
    for (let i = 0; i < stops.length; i++) {
      const d = haversineDistance(stops[i].latitude, stops[i].longitude, depot.lat, depot.lng);
      if (d < minDist) { minDist = d; startIdx = i; }
    }
  } else {
    const c = centroid(stops);
    let maxDist = -1;
    for (let i = 0; i < stops.length; i++) {
      const d = haversineDistance(stops[i].latitude, stops[i].longitude, c.lat, c.lng);
      if (d > maxDist) { maxDist = d; startIdx = i; }
    }
  }

  const visited = new Array(stops.length).fill(false);
  const route: number[] = [];
  let totalDistance = 0;
  let current = startIdx;

  visited[current] = true;
  route.push(stops[current].id);

  while (route.length < stops.length) {
    let nearest = -1;
    let minDist = Infinity;
    for (let i = 0; i < stops.length; i++) {
      if (!visited[i]) {
        const d = haversineDistance(
          stops[current].latitude, stops[current].longitude,
          stops[i].latitude, stops[i].longitude
        );
        if (d < minDist) { minDist = d; nearest = i; }
      }
    }
    if (nearest === -1) break;
    visited[nearest] = true;
    route.push(stops[nearest].id);
    totalDistance += minDist;
    current = nearest;
  }

  return { route, distance: totalDistance };
}

function routeDistance(stops: Stop[]): number {
  return nearestNeighborRoute(stops).distance;
}

// --- K-Means++ başlatmalı clustering (seed ile tekrarlanabilir rastgelelik) ---

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function runKMeans(stops: Stop[], k: number, iterations = 12, seed = 42): Stop[][] {
  if (k <= 1 || stops.length <= k) return stops.length === 0 ? [] : [stops];

  const rng = seededRandom(seed);

  // Rastgele ilk merkez + uzak nokta seçimi (seed'e göre farklılaşır)
  const shuffled = shuffle(stops, rng);
  const firstIdx = Math.floor(rng() * shuffled.length);

  const centroids: { lat: number; lng: number }[] = [
    { lat: shuffled[firstIdx].latitude, lng: shuffled[firstIdx].longitude },
  ];

  while (centroids.length < k) {
    let maxMinDist = -1;
    let farthestIdx = 0;
    for (let i = 0; i < shuffled.length; i++) {
      const minDist = Math.min(
        ...centroids.map(c => effectiveDistance(shuffled[i].latitude, shuffled[i].longitude, c.lat, c.lng))
      );
      if (minDist > maxMinDist) { maxMinDist = minDist; farthestIdx = i; }
    }
    centroids.push({ lat: shuffled[farthestIdx].latitude, lng: shuffled[farthestIdx].longitude });
  }

  // Orijinal sırayla atama yap (Boğaz cezalı mesafe ile)
  const assigned = new Array(stops.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (let i = 0; i < stops.length; i++) {
      let minDist = Infinity;
      let nearest = 0;
      for (let j = 0; j < k; j++) {
        const d = effectiveDistance(stops[i].latitude, stops[i].longitude, centroids[j].lat, centroids[j].lng);
        if (d < minDist) { minDist = d; nearest = j; }
      }
      if (assigned[i] !== nearest) { assigned[i] = nearest; changed = true; }
    }
    for (let j = 0; j < k; j++) {
      const members = stops.filter((_, i) => assigned[i] === j);
      if (members.length > 0) centroids[j] = centroid(members);
    }
    if (!changed) break;
  }

  const clusters: Stop[][] = Array.from({ length: k }, () => []);
  stops.forEach((s, i) => clusters[assigned[i]].push(s));
  return clusters.filter(c => c.length > 0);
}

// --- Büyük kümeleri böl (sıkışık alanlar için esneklik) ---

// softMax/hardMax = max durak (adres) sayısı
function splitCluster(stops: Stop[], softMax: number, hardMax: number, seed = 42): Stop[][] {
  if (stops.length <= 1) return [stops];

  const stopCount = stops.length;
  const diameter = stopCount >= 2 ? clusterDiameter(stops) : 0;

  const tooMany = stopCount > softMax;
  const tooWide = diameter > MAX_DIAMETER_KM;

  if (!tooMany && !tooWide) return [stops];

  // Sıkışık mahalle (yarıçap ≤ 2km) ve hardMax altındaysa bölme
  if (stopCount <= hardMax && isTight(stops)) return [stops];

  const byStops = Math.ceil(stopCount / softMax);
  const byDiameter = tooWide ? Math.ceil(diameter / MAX_DIAMETER_KM) : 1;
  const numParts = Math.min(Math.max(2, byStops, byDiameter), stopCount);
  if (numParts <= 1) return [stops];

  const subClusters = runKMeans(stops, numParts, 12, seed);

  const result: Stop[][] = [];
  for (const sub of subClusters) {
    if (sub.length === stops.length) { result.push(sub); continue; }
    result.push(...splitCluster(sub, softMax, hardMax, seed + 1));
  }
  return result;
}

// --- Küçük kümeleri yakın komşuyla birleştir ---

// minSize adresten az olan kümeleri birleştirir.
// Önce maxSize'a uymaya çalışır; hiç komşu sığmıyorsa en yakın komşuya
// zorla birleştirir (min kural max kuraldan daha önceliklidir).
function mergeSmallClusters(clusters: Stop[][], minSize: number, maxSize = Infinity): Stop[][] {
  const result = clusters.map(c => [...c]);
  let changed = true;

  while (changed) {
    changed = false;
    const smallIdx = result.findIndex(c => c.length < minSize);
    if (smallIdx === -1) break;

    const smallC = centroid(result[smallIdx]);
    let nearestIdx = -1;
    let minDist = Infinity;

    // 1. Tercih: maxSize'ı aşmayan en yakın komşu
    for (let i = 0; i < result.length; i++) {
      if (i === smallIdx) continue;
      if (result[i].length + result[smallIdx].length > maxSize) continue;
      const d = haversineDistance(smallC.lat, smallC.lng, centroid(result[i]).lat, centroid(result[i]).lng);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }

    // 2. Zorunlu fallback: hiç komşu sığmıyorsa limiti görmezden gel
    //    (4 adreste araç bırakmak, 24 adresli araçtan daha kötüdür)
    if (nearestIdx === -1) {
      minDist = Infinity;
      for (let i = 0; i < result.length; i++) {
        if (i === smallIdx) continue;
        const d = haversineDistance(smallC.lat, smallC.lng, centroid(result[i]).lat, centroid(result[i]).lng);
        if (d < minDist) { minDist = d; nearestIdx = i; }
      }
    }

    if (nearestIdx !== -1) {
      result[nearestIdx] = [...result[nearestIdx], ...result[smallIdx]];
      result.splice(smallIdx, 1);
      changed = true;
    }
  }

  return result;
}

// --- Araçlar arası km dengeleme ---
// Her araçın toplam rotasını hesaplar; en uzun ile en kısa arasındaki fark
// %20'nin üzerindeyse, en uzun araçtan en kısaya sınır durakları taşır.

function balanceDistances(
  clusters: Stop[][],
  minSize: number,
  softMax: number,
  hardMax: number,
  maxPasses = 60
): Stop[][] {
  const result = clusters.map(c => [...c]);

  for (let pass = 0; pass < maxPasses; pass++) {
    const distances = result.map(c => routeDistance(c));
    const maxDist = Math.max(...distances);
    const minDist = Math.min(...distances);

    if (maxDist === 0 || (maxDist - minDist) / maxDist < 0.20) break;

    // Uzundan kısaya doğru taşıma dene
    const sortedDesc = distances
      .map((d, i) => ({ i, d }))
      .sort((a, b) => b.d - a.d);

    let moved = false;

    outerLoop:
    for (const { i: hiIdx } of sortedDesc) {
      if (totalCustomers(result[hiIdx]) <= minSize) continue;

      const sortedAsc = distances
        .map((d, i) => ({ i, d }))
        .sort((a, b) => a.d - b.d);

      for (const { i: loIdx } of sortedAsc) {
        if (loIdx === hiIdx) continue;
        const allowedMax = isTight(result[loIdx]) ? hardMax : softMax;
        if (totalCustomers(result[loIdx]) >= allowedMax) continue;

        const loC = centroid(result[loIdx]);

        // Yüksek-km aracındaki duraklar içinden loCluster'a en yakın olanı seç
        let bestStop = -1;
        let bestDist = Infinity;
        for (let i = 0; i < result[hiIdx].length; i++) {
          const d = haversineDistance(
            result[hiIdx][i].latitude, result[hiIdx][i].longitude,
            loC.lat, loC.lng
          );
          if (d < bestDist) { bestDist = d; bestStop = i; }
        }

        if (bestStop !== -1) {
          const [s] = result[hiIdx].splice(bestStop, 1);
          result[loIdx].push(s);
          moved = true;
          break outerLoop;
        }
      }
    }

    if (!moved) break;
  }

  return result;
}

// --- Sektör tabanlı kümeleme ---
// Depo veya referans noktasından her durağa açı hesaplanır.
// Durağlar açısal sıraya göre araçlara dağıtılır: her araç ayrı bir dilim.
// Bu yöntemle araçlar birbirinin bölgesine girmez (kesişme geometrik olarak
// imkânsız hale gelir), çünkü her araç ayrı bir açı aralığından sorumludur.

function angleFromRef(refLat: number, refLng: number, lat: number, lng: number): number {
  return Math.atan2(lng - refLng, lat - refLat); // -π .. +π
}

// groupSize : araç başına hedef adres (araç sayısını belirler)
// splitMax  : bu sayıyı aşan sektörler bölünür (Anadolu = groupSize, Avrupa = çok yüksek → bölme yok)
function sectorCluster(
  stops: Stop[],
  groupSize: number,
  splitMax: number,
  refLat: number,
  refLng: number,
  angleOffset: number,
): Stop[][] {
  if (stops.length === 0) return [];

  const MIN_SIZE = 10; // bir araçta en az 10 adres olmalı

  // Referans noktasına göre açısal sırala (angleOffset ile sınır kaydırılır)
  const sorted = [...stops].sort((a, b) => {
    let aA = angleFromRef(refLat, refLng, a.latitude, a.longitude) + angleOffset;
    let bA = angleFromRef(refLat, refLng, b.latitude, b.longitude) + angleOffset;
    if (aA <= -Math.PI) aA += 2 * Math.PI;
    if (bA <= -Math.PI) bA += 2 * Math.PI;
    return aA - bA;
  });

  // groupSize'a göre araç sayısı ve hedef hesapla
  const numVehicles = Math.max(1, Math.ceil(sorted.length / groupSize));
  const targetPerVehicle = sorted.length / numVehicles;

  // Sıralı durağları araçlara dağıt
  const clusters: Stop[][] = [];
  let current: Stop[] = [];

  for (let i = 0; i < sorted.length; i++) {
    current.push(sorted[i]);
    if (current.length >= targetPerVehicle && clusters.length < numVehicles - 1) {
      clusters.push(current);
      current = [];
    }
  }
  if (current.length > 0) clusters.push(current);

  // splitMax'ı aşan sektörleri böl (Avrupa'da splitMax çok yüksek → pratikte bölünmez)
  const split: Stop[][] = [];
  for (const c of clusters) split.push(...splitCluster(c, splitMax, splitMax, 42));

  // Min 12 garantisi — sığacak yer yoksa zorla birleştir, min kural önceliklidir
  return mergeSmallClusters(split, MIN_SIZE, splitMax);
}

// Dengeleme skoru: araçlar arası km farkı oranı (düşük = daha dengeli)
function balanceScore(groups: RouteGroup[]): number {
  if (groups.length <= 1) return 0;
  const dists = groups.map(g => g.totalDistance);
  const max = Math.max(...dists);
  const min = Math.min(...dists);
  return max === 0 ? 0 : (max - min) / max;
}

// --- Tek yaka için N deneme, en dengeli sonucu döner ---
// Her denemede sektör sınırları farklı açıdan başlar → en dengeli dağılım seçilir.

// splitMax: Anadolu için groupSize (sert limit), Avrupa için 999 (bölme yok)
function optimizeSide(stops: Stop[], groupSize: number, splitMax: number, attempts: number, depot: Depot | undefined, side: 'Anadolu' | 'Avrupa'): RouteGroup[] {
  if (stops.length === 0) return [];

  // Referans nokta: depo varsa depo (Pendik), yoksa merkez
  const ref = depot ?? centroid(stops);

  let best: RouteGroup[] | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < attempts; i++) {
    // Her denemede sektör sınırı eşit aralıklarla kaydırılır
    const offset = (i / attempts) * 2 * Math.PI;
    const clusters = sectorCluster(stops, groupSize, splitMax, ref.lat, ref.lng, offset);
    const groups: RouteGroup[] = clusters.map((cluster, idx) => {
      const { route, distance } = nearestNeighborRoute(cluster, depot);
      return { groupId: idx + 1, addresses: cluster, optimizedRoute: route, totalDistance: distance };
    });
    const score = balanceScore(groups);
    if (score < bestScore) {
      bestScore = score;
      best = groups;
    }
  }

  return (best || []).map(g => ({ ...g, side }));
}

// --- Ana export: Anadolu ve Avrupa yakasını kesin olarak ayırır ---
// anadoluGroupSize: Anadolu yakası araç başına max durak sayısı (default 25)
// avrupaGroupSize:  Avrupa yakası araç başına max durak sayısı (default 20)

export function optimizeRoutes(
  stops: Stop[],
  anadoluGroupSize: number = 25,
  avrupaGroupSize: number = 20,
  attempts = 5,
  depot?: Depot,
): RouteGroup[] {
  if (stops.length === 0) return [];

  // Boğaz eğimli çizgisine göre kesin yaka ayrımı
  const anadoluStops = stops.filter(s => isAsianSide(s.latitude, s.longitude));
  const avrupaStops  = stops.filter(s => !isAsianSide(s.latitude, s.longitude));

  // Anadolu: groupSize sert limit (splitMax = groupSize)
  // Avrupa: groupSize araç sayısını belirler ama sert bölme yok (splitMax = 999)
  const anadoluRoutes = optimizeSide(anadoluStops, anadoluGroupSize, anadoluGroupSize, attempts, depot, 'Anadolu');
  const avrupaRoutes  = optimizeSide(avrupaStops,  avrupaGroupSize,  999,              attempts, undefined, 'Avrupa');

  // Önce Anadolu, sonra Avrupa; ardışık groupId ver
  const combined = [...anadoluRoutes, ...avrupaRoutes];
  return combined.map((g, idx) => ({ ...g, groupId: idx + 1 }));
}

// Geriye dönük uyumluluk
export function clusterAddresses(stops: Stop[], groupSize: number = 25): Stop[][] {
  const SOFT_MAX = groupSize;
  const HARD_MAX = Math.ceil(groupSize * 1.4);
  const MIN_SIZE = 10;

  const numClusters = Math.max(1, Math.ceil(stops.length / SOFT_MAX));
  let clusters = runKMeans(stops, numClusters, 12, Date.now());

  const split: Stop[][] = [];
  for (const c of clusters) split.push(...splitCluster(c, SOFT_MAX, HARD_MAX, Date.now()));
  clusters = split;

  return mergeSmallClusters(clusters, MIN_SIZE);
}

export function optimizeRouteNearestNeighbor(stops: Stop[]): { route: number[]; distance: number } {
  return nearestNeighborRoute(stops);
}
