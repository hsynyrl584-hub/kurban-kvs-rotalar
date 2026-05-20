import { Router, Request, Response } from 'express';
import { optimizeRoutes } from '../services/routeOptimizer';
import { geocodeAddress } from '../services/googleMapsService';

export const routeOptimizationRouter = Router();

interface Customer {
  id: number;
  isim: string;
  tel1: string;
  tel2: string;
  adres: string;
}

interface GeocodedStop {
  id: number;
  adres: string;
  latitude: number;
  longitude: number;
  customers: Customer[];
}

// POST /api/customers/optimize
// Body: { customers: Customer[], groupSize?: number }
routeOptimizationRouter.post('/customers/optimize', async (req: Request, res: Response) => {
  try {
    const {
      customers,
      groupSize = 25,
      attempts = 5,
      depotAddress = 'Ramazanoğlu Sanayi Cd. N:2 Pendik İstanbul',
    } = req.body;

    if (!Array.isArray(customers) || customers.length === 0) {
      return res.status(400).json({ error: 'Geçerli müşteri listesi gerekli' });
    }

    // Adresleri normalize ederek grupla (aynı adres = tek durak)
    const addressMap = new Map<string, { adres: string; customers: Customer[] }>();
    for (const c of customers) {
      if (!c.adres?.trim()) continue;
      const key = c.adres.trim().toLowerCase();
      if (!addressMap.has(key)) {
        addressMap.set(key, { adres: c.adres.trim(), customers: [] });
      }
      addressMap.get(key)!.customers.push(c);
    }

    // Her benzersiz adresi geocode et (paralel, 10'lu gruplar)
    const addressEntries = [...addressMap.values()];
    const geocodedStops: GeocodedStop[] = [];
    const failedAddresses: string[] = [];
    const BATCH = 10;

    for (let i = 0; i < addressEntries.length; i += BATCH) {
      const batch = addressEntries.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (entry) => {
          const coords = await geocodeAddress(entry.adres);
          return { entry, coords };
        })
      );

      results.forEach(({ entry, coords }, batchIdx) => {
        if (coords) {
          geocodedStops.push({
            id: geocodedStops.length + 1,
            adres: entry.adres,
            latitude: coords.lat,
            longitude: coords.lng,
            customers: entry.customers,
          });
        } else {
          failedAddresses.push(entry.adres);
          console.warn(`Geocode başarısız: ${entry.adres}`);
        }
      });
    }

    if (geocodedStops.length === 0) {
      return res.status(400).json({
        error: 'Hiçbir adres koordinata çevrilemedi. Google Maps API anahtarını kontrol edin.',
      });
    }

    // Depot geocode et (başlangıç noktası)
    const depotCoords = await geocodeAddress(depotAddress);
    const depot = depotCoords ? { lat: depotCoords.lat, lng: depotCoords.lng } : undefined;

    // Rota optimizasyonu (N deneme, en dengeli sonuç)
    const optimizedRoutes = optimizeRoutes(geocodedStops, groupSize, Math.min(Math.max(1, attempts), 10), depot);

    // Durakları müşteri listeleriyle birleştir
    const routes = optimizedRoutes.map((group) => {
      const totalCustomers = group.addresses.reduce(
        (sum, a) => sum + ((a as any).customers?.length || 0),
        0
      );

      const stops = group.optimizedRoute.map((stopId, order) => {
        const stop = geocodedStops.find((s) => s.id === stopId)!;
        return {
          order: order + 1,
          adres: stop.adres,
          latitude: stop.latitude,
          longitude: stop.longitude,
          customers: stop.customers,
        };
      });

      return {
        groupId: group.groupId,
        stopCount: stops.length,
        customerCount: totalCustomers,
        totalDistance: group.totalDistance.toFixed(2),
        stops,
      };
    });

    res.json({
      status: 'success',
      totalCustomers: customers.length,
      uniqueAddresses: geocodedStops.length,
      failedAddresses: failedAddresses.length,
      groups: routes.length,
      routes,
    });
  } catch (error) {
    console.error('Optimize hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası', details: String(error) });
  }
});

// GET /api/health
routeOptimizationRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// GET /api/debug - API key kontrolü
routeOptimizationRouter.get('/debug', async (_req: Request, res: Response) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const keyStatus = key ? `SET (${key.length} chars, starts: ${key.substring(0,8)}...)` : 'NOT SET';

  let geocodeTest = 'not tested';
  if (key) {
    const result = await geocodeAddress('Kadıköy İstanbul');
    geocodeTest = result ? `OK (${result.lat}, ${result.lng})` : 'FAILED - check logs';
  }

  res.json({ keyStatus, geocodeTest });
});
