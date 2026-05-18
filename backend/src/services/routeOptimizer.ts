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

// --- Nearest Neighbor rota optimizasyonu ---

function nearestNeighborRoute(stops: Stop[]): { route: number[]; distance: number } {
  if (stops.length === 0) return { route: [], distance: 0 };
  if (stops.length === 1) return { route: [stops[0].id], distance: 0 };

  // Merkeze en uzak noktadan başla — daha iyi turlar üretir
  const c = centroid(stops);
  let startIdx = 0;
  let maxDist = -1;
  for (let i = 0; i < stops.length; i++) {
    const d = haversineDistance(stops[i].latitude, stops[i].longitude, c.lat, c.lng);
    if (d > maxDist) { maxDist = d; startIdx = i; }
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
        ...centroids.map(c => haversineDistance(shuffled[i].latitude, shuffled[i].longitude, c.lat, c.lng))
      );
      if (minDist > maxMinDist) { maxMinDist = minDist; farthestIdx = i; }
    }
    centroids.push({ lat: shuffled[farthestIdx].latitude, lng: shuffled[farthestIdx].longitude });
  }

  // Orijinal sırayla atama yap
  const assigned = new Array(stops.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (let i = 0; i < stops.length; i++) {
      let minDist = Infinity;
      let nearest = 0;
      for (let j = 0; j < k; j++) {
        const d = haversineDistance(stops[i].latitude, stops[i].longitude, centroids[j].lat, centroids[j].lng);
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

function splitCluster(stops: Stop[], softMax: number, hardMax: number, seed = 42): Stop[][] {
  if (stops.length <= 1) return [stops];

  const custCount = totalCustomers(stops);
  const diameter = stops.length >= 2 ? clusterDiameter(stops) : 0;

  // Coğrafi olarak çok geniş alanı kaplamıyorsa ve müşteri limiti aşılmıyorsa bölme
  const tooManyCustomers = custCount > softMax;
  const tooWide = diameter > MAX_DIAMETER_KM;

  if (!tooManyCustomers && !tooWide) return [stops];

  // Sıkışık mahalle ve hardMax altındaysa bölme (aynı bölge fazla müşteri olabilir)
  if (custCount <= hardMax && isTight(stops)) return [stops];

  // Kaç parçaya böleceğimizi belirle: müşteri sayısına ve coğrafi genişliğe göre
  const byCustomers = Math.ceil(custCount / softMax);
  const byDiameter = tooWide ? Math.ceil(diameter / MAX_DIAMETER_KM) : 1;
  const numParts = Math.min(Math.max(2, byCustomers, byDiameter), stops.length);
  if (numParts <= 1) return [stops];

  const subClusters = runKMeans(stops, numParts, 12, seed);

  const result: Stop[][] = [];
  for (const sub of subClusters) {
    if (sub.length === stops.length) { result.push(sub); continue; } // sonsuz döngü koruması
    result.push(...splitCluster(sub, softMax, hardMax, seed + 1));
  }
  return result;
}

// --- Küçük kümeleri yakın komşuyla birleştir ---

function mergeSmallClusters(clusters: Stop[][], minSize: number): Stop[][] {
  const result = clusters.map(c => [...c]);
  let changed = true;

  while (changed) {
    changed = false;
    const smallIdx = result.findIndex(c => totalCustomers(c) < minSize);
    if (smallIdx === -1) break;

    const smallC = centroid(result[smallIdx]);
    let nearestIdx = -1;
    let minDist = Infinity;
    for (let i = 0; i < result.length; i++) {
      if (i === smallIdx) continue;
      const d = haversineDistance(smallC.lat, smallC.lng, centroid(result[i]).lat, centroid(result[i]).lng);
      if (d < minDist) { minDist = d; nearestIdx = i; }
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

// --- Tek deneme (belirli seed ile) ---

function runOnce(stops: Stop[], groupSize: number, seed: number): RouteGroup[] {
  const SOFT_MAX = groupSize;
  const HARD_MAX = Math.ceil(groupSize * 1.4);
  const MIN_SIZE = 10;

  const numClusters = Math.max(1, Math.ceil(stops.length / SOFT_MAX));
  let clusters = runKMeans(stops, numClusters, 12, seed);

  const split: Stop[][] = [];
  for (const c of clusters) split.push(...splitCluster(c, SOFT_MAX, HARD_MAX, seed));
  clusters = split;

  clusters = mergeSmallClusters(clusters, MIN_SIZE);
  clusters = balanceDistances(clusters, MIN_SIZE, SOFT_MAX, HARD_MAX);
  clusters = mergeSmallClusters(clusters, MIN_SIZE);

  return clusters.map((cluster, idx) => {
    const { route, distance } = nearestNeighborRoute(cluster);
    return { groupId: idx + 1, addresses: cluster, optimizedRoute: route, totalDistance: distance };
  });
}

// Dengeleme skoru: araçlar arası km farkı oranı (düşük = daha dengeli)
function balanceScore(groups: RouteGroup[]): number {
  if (groups.length <= 1) return 0;
  const dists = groups.map(g => g.totalDistance);
  const max = Math.max(...dists);
  const min = Math.min(...dists);
  return max === 0 ? 0 : (max - min) / max;
}

// --- Ana export: N farklı seed dener, en dengeli sonucu döner ---

export function optimizeRoutes(stops: Stop[], groupSize: number = 25, attempts = 5): RouteGroup[] {
  if (stops.length === 0) return [];

  let best: RouteGroup[] | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < attempts; i++) {
    const seed = Date.now() + i * 9973; // her çağrıda farklı seed
    const result = runOnce(stops, groupSize, seed);
    const score = balanceScore(result);
    if (score < bestScore) {
      bestScore = score;
      best = result;
    }
  }

  return (best || []).map((g, idx) => ({ ...g, groupId: idx + 1 }));
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
