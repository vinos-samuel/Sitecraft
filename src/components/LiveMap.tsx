'use client';
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, FeatureGroup } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import L from 'leaflet';

// Fix leaflet default icon paths for Next.js
const defaultIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

function MapBoundsUpdater({ leads }: { leads: any[] }) {
  const map = useMap();
  useEffect(() => {
    if (leads && leads.length > 0) {
      const bounds = L.latLngBounds(leads.map(l => [l.lat, l.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
    
    // Fix Leaflet icons missing in Next.js dynamically
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png').default?.src || 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: require('leaflet/dist/images/marker-icon.png').default?.src || 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: require('leaflet/dist/images/marker-shadow.png').default?.src || 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
  }, [leads, map]);
  return null;
}

export default function LiveMap({ leads = [], onLeadSelect }: { leads?: any[], onLeadSelect?: (lead: any) => void }) {
  // Leaflet-draw needs to execute strictly on client payload 
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const onShapeCreated = async (e: any) => {
    const layer = e.layer;
    const geoJson = layer.toGeoJSON();
    try {
      await fetch('/api/territories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Territory ' + new Date().toLocaleTimeString(), geoJson: JSON.stringify(geoJson) })
      });
    } catch(err) { console.error(err); }
  };

  return (
    <div style={{ height: '100%', width: '100%', borderRadius: '12px', overflow: 'hidden' }}>
      <MapContainer 
        center={[30.2672, -97.7431]} // Default Austin, TX
        zoom={12} 
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', zIndex: 1 }}
      >
        <MapBoundsUpdater leads={leads} />
        
        {mounted && (
          <FeatureGroup>
            <EditControl
              position='topright'
              onCreated={onShapeCreated}
              draw={{
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false,
              }}
            />
          </FeatureGroup>
        )}

        {/* Light basemap to match the Broadsheet theme */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        {leads.length > 0 ? (
          leads.map((lead: any) => (
            <Marker 
              key={lead.id} 
              position={[lead.lat || 30.2672, lead.lng || -97.7431]} 
              icon={defaultIcon}
              eventHandlers={{
                click: () => onLeadSelect && onLeadSelect(lead)
              }}
            >
              <Popup>
                <div style={{ color: '#000', fontSize: '0.9rem' }}>
                  <strong>{lead.name}</strong><br/>
                  ⭐ {lead.rating} ({lead.reviewsCount} reviews)<br/>
                  📞 {lead.phone}
                </div>
              </Popup>
            </Marker>
          ))
        ) : (
          <Marker position={[30.2672, -97.7431]} icon={defaultIcon}>
            <Popup>
              <div style={{ color: '#000' }}>
                <strong>OmniLead Base</strong><br/>
                Awaiting scraping tasks...
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
