const SRI_LANKA_VIEWBOX = '79.6,9.9,81.95,5.9';

export const searchPlaces = async (query, limit = 8) => {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${trimmed}, Sri Lanka`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'lk');
  url.searchParams.set('viewbox', SRI_LANKA_VIEWBOX);
  url.searchParams.set('bounded', '1');
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to search places');
  }

  const data = await response.json();
  return (Array.isArray(data) ? data : []).map((item) => ({
    id: item.place_id,
    name: item.display_name,
    shortName: item.name || item.display_name?.split(',')[0] || 'Selected Place',
    lat: Number(item.lat),
    lng: Number(item.lon),
  })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
};

export const fetchRoute = async (stops) => {
  if (!Array.isArray(stops) || stops.length < 2) {
    return [];
  }

  const coords = stops
    .map((s) => `${s.lng},${s.lat}`)
    .join(';');

  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch route');
  }

  const data = await response.json();
  const route = data?.routes?.[0]?.geometry?.coordinates;

  if (!Array.isArray(route)) {
    return [];
  }

  return route
    .map((coord) => ({ lng: Number(coord[0]), lat: Number(coord[1]) }))
    .filter((coord) => Number.isFinite(coord.lat) && Number.isFinite(coord.lng));
};
