import axios from 'axios';

// Aynı adresi tekrar tekrar sorgulamayı önler
const geocodeCache = new Map<string, { lat: number; lng: number }>();

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  // process.env burada okunuyor (modül yüklenme zamanında değil)
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY tanımlanmamış');
    return null;
  }

  // Excel multi-line hücrelerini tek satıra çevir
  const cleanAddress = address.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

  const cacheKey = cleanAddress.toLowerCase();
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: cleanAddress, key: apiKey, language: 'tr', region: 'tr' },
      timeout: 8000,
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const loc = response.data.results[0].geometry.location;
      const result = { lat: loc.lat, lng: loc.lng };
      geocodeCache.set(cacheKey, result);
      return result;
    }

    console.warn(`Geocode sonuç yok: "${address}" — status: ${response.data.status}`);
    return null;
  } catch (error) {
    console.error(`Geocode hatası "${address}":`, error);
    return null;
  }
}
