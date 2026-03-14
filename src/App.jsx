import React, { useState, useRef } from 'react';
import { places } from './data';
import { Download, Eye, X, Check, MapPin, Calendar, User, Image as ImageIcon, Edit2, Trash2, Plus, Plane, Camera, Palmtree, Compass, Cloud, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Analytics } from "@vercel/analytics/react";

import galleryDataRaw from './gallery_data.json';
import { supabase } from './supabase';
import { CITY_PDF_CONTAINER_ID, CityPDFContent, downloadCityPdfFromContainer } from './cityPdf';
import RouteMapPlanner, { hasRenderableRouteMapPlan } from './components/RouteMapPlanner';
import { TypeScriptPdfLayoutEngine } from './pdf-engine';
import ItineraryPDFContent, { generateItineraryPdf } from './itineraryPdf';
import { ensurePdfLayoutValid } from './pdfLayoutValidation';

const ROUTE_MAP_SNAPSHOT_KEY = 'route_map_saved_snapshot_v1';
const LOGIN_ROLE_KEY = 'itinerary_login_role_v1';
const SUB_PLACES_BACKUP_KEY = 'destination_sub_places_backup_v1';
const DESTINATION_WRITE_QUEUE_KEY = 'destination_pending_write_queue_v1';
const LOCAL_LOGIN_CREDENTIALS = {
    admin: 'admin',
    user: 'user',
};
const REMOVED_KANDY_SUB_PLACE_KEYS = new Set([
    'ambacce gadladeniya and lankathilaka',
    'peradeniya botanikal garden',
    'bahirawa kanda',
    'knuckles',
    'sembuwatta',
    'st pauls church and anglican church',
]);

const CARD_STYLES = [
    { bg: 'linear-gradient(135deg, #fff5f5 0%, #ffe3e3 100%)', border: '#fca5a5', accent: '#e53e3e' }, // Red
    { bg: 'linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%)', border: '#9ae6b4', accent: '#2f855a' }, // Green
    { bg: 'linear-gradient(135deg, #ebf8ff 0%, #bee3f8 100%)', border: '#90cdf4', accent: '#2b6cb0' }, // Blue
    { bg: 'linear-gradient(135deg, #fffff0 0%, #fefcbf 100%)', border: '#faf089', accent: '#b7791f' }, // Yellow/Gold
    { bg: 'linear-gradient(135deg, #faf5ff 0%, #e9d8fd 100%)', border: '#d6bcfa', accent: '#6b46c1' }, // Purple
    { bg: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)', border: '#fbd38d', accent: '#c05621' }, // Orange
    { bg: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)', border: '#81e6d9', accent: '#2c7a7b' }, // Teal
    { bg: 'linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)', border: '#fbb6ce', accent: '#b83280' }, // Pink
];


const resizeImage = (file, maxWidth = 1000, quality = 0.7) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
};

const getSubPlaceName = (sub) => {
    if (typeof sub === 'string') return sub.trim();
    if (!sub || typeof sub !== 'object') return '';
    const raw = sub.name || sub.title || sub.place || sub.label || '';
    return String(raw).trim();
};

const normalizeSubPlaces = (rawSubPlaces) => {
    if (typeof rawSubPlaces === 'string') {
        return rawSubPlaces
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((name) => ({ name, description: '' }));
    }

    if (!Array.isArray(rawSubPlaces)) return [];

    const normalized = rawSubPlaces
        .map((entry) => {
            if (typeof entry === 'string') {
                const name = entry.trim();
                return name ? { name, description: '' } : null;
            }
            if (!entry || typeof entry !== 'object') return null;

            const name = getSubPlaceName(entry);
            const descriptionRaw = entry.description || entry.details || entry.note || '';
            const description = typeof descriptionRaw === 'string' ? descriptionRaw.trim() : '';
            if (!name) return null;
            return { name, description };
        })
        .filter(Boolean);

    const deduped = [];
    const seen = new Set();
    normalized.forEach((item) => {
        const key = item.name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(item);
    });
    return deduped;
};

const sanitizeLegacyKandySubPlaces = (placeId, rawSubPlaces) => {
    const normalized = normalizeSubPlaces(rawSubPlaces);
    if (String(placeId || '').toLowerCase() !== 'kandy') {
        return normalized;
    }
    return normalized.filter((item) => !REMOVED_KANDY_SUB_PLACE_KEYS.has(String(item?.name || '').toLowerCase()));
};

const mergeSubPlacesByName = (...lists) => {
    const merged = [];
    const byKey = new Map();

    lists.forEach((list) => {
        const normalized = normalizeSubPlaces(list);
        normalized.forEach((item) => {
            const key = item.name.toLowerCase();
            const existing = byKey.get(key);
            if (!existing) {
                const next = { name: item.name, description: item.description || '' };
                byKey.set(key, next);
                merged.push(next);
                return;
            }
            if (!existing.description && item.description) {
                existing.description = item.description;
            }
        });
    });

    return merged;
};

const hydrateSelectedSubPlaces = (selectedSubPlaces, masterSubPlaces) => {
    const master = normalizeSubPlaces(masterSubPlaces);
    const masterMap = new Map(master.map((sp) => [sp.name.toLowerCase(), sp]));
    return (Array.isArray(selectedSubPlaces) ? selectedSubPlaces : [])
        .map((sub) => {
            const name = getSubPlaceName(sub);
            if (!name) return null;
            const fromMaster = masterMap.get(name.toLowerCase());
            if (fromMaster) return { ...fromMaster };
            const description = typeof sub === 'string'
                ? ''
                : (typeof sub?.description === 'string' ? sub.description.trim() : '');
            return { name, description };
        })
        .filter(Boolean);
};

const readDestinationWriteQueue = () => {
    try {
        const raw = localStorage.getItem(DESTINATION_WRITE_QUEUE_KEY) || '[]';
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeDestinationWriteQueue = (queue) => {
    try {
        localStorage.setItem(DESTINATION_WRITE_QUEUE_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
    } catch {
        // Ignore localStorage errors.
    }
};

function App() {
    const [numDays, setNumDays] = useState(1);
    const [activeDay, setActiveDay] = useState(1);
    const [itinerary, setItinerary] = useState({ 1: [] }); // { 1: [place1, place2], 2: [] }
    const [customImages, setCustomImages] = useState({});
    const [arrivalDate, setArrivalDate] = useState('');
    const [departureDate, setDepartureDate] = useState('');
    const [useTravelDates, setUseTravelDates] = useState(true);
    const [manualDaysCount, setManualDaysCount] = useState(1);
    const [manualNightsCount, setManualNightsCount] = useState(0);
    const [tripStart, setTripStart] = useState('');
    const [tripEnd, setTripEnd] = useState('');
    const [flightDetails, setFlightDetails] = useState('');
    const [currentStep, setCurrentStep] = useState(1); // 1: Setup, 2: Builder
    const [generationTime, setGenerationTime] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showPreview, setShowPreview] = useState(false);
    const [showCityPreview, setShowCityPreview] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isGeneratingCityPdf, setIsGeneratingCityPdf] = useState(false);
    const [isPreparingPreview, setIsPreparingPreview] = useState(false);
    const [itineraryPdfScale, setItineraryPdfScale] = useState(1);
    const [systemPopup, setSystemPopup] = useState({
        open: false,
        title: '',
        message: '',
        details: '',
        tone: 'error',
    });
    const [cityPdfPlace, setCityPdfPlace] = useState(null);
    const [cityPdfSelectedSubIndexes, setCityPdfSelectedSubIndexes] = useState([]);
    const [userPlaces, setUserPlaces] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [showDayNote, setShowDayNote] = useState({}); // { 1: true, 2: false }
    const [dayNoteText, setDayNoteText] = useState({}); // { 1: "Note for day 1" }
    const [showCityNote, setShowCityNote] = useState({}); // { 1: true, 2: false }
    const [selectedCityForNote, setSelectedCityForNote] = useState({}); // { 1: 0, 2: 1 }
    const [routeMapPlan, setRouteMapPlan] = useState({ enabled: false, attachToFinalPdf: false, stops: [], routeCoords: [] });
    const routeMapPlanRef = useRef(routeMapPlan);

    React.useEffect(() => {
        routeMapPlanRef.current = routeMapPlan;
    }, [routeMapPlan]);

    const handleRouteMapPlanChange = React.useCallback((nextPlanOrUpdater) => {
        setRouteMapPlan((prev) => {
            const nextPlan = typeof nextPlanOrUpdater === 'function'
                ? nextPlanOrUpdater(prev)
                : (nextPlanOrUpdater || prev);
            routeMapPlanRef.current = nextPlan;
            return nextPlan;
        });
    }, []);

    const routeMapPlanForPdf = React.useMemo(() => {
        const latestPlan = routeMapPlanRef.current || routeMapPlan || {};
        let persistedSnapshot = '';
        try {
            persistedSnapshot = localStorage.getItem(ROUTE_MAP_SNAPSHOT_KEY) || '';
        } catch (_err) {
            persistedSnapshot = '';
        }
        return {
            ...(latestPlan || {}),
            mapSnapshot: latestPlan?.mapSnapshot || persistedSnapshot || '',
        };
    }, [routeMapPlan]);

    const shouldIncludeRouteMapPage = routeMapPlanForPdf?.attachToFinalPdf === true
        && hasRenderableRouteMapPlan(routeMapPlanForPdf)
        && Boolean(routeMapPlanForPdf?.mapSnapshot);

    const showSystemPopup = React.useCallback(({
        title = 'System Message',
        message = 'Something went wrong. Please try again.',
        details = '',
        tone = 'error',
    }) => {
        setSystemPopup({
            open: true,
            title,
            message,
            details: typeof details === 'string' ? details : String(details || ''),
            tone,
        });
    }, []);

    const closeSystemPopup = React.useCallback(() => {
        setSystemPopup((prev) => ({ ...prev, open: false }));
    }, []);

    const enqueueDestinationWrite = React.useCallback((payload) => {
        const queue = readDestinationWriteQueue();
        const filtered = queue.filter((q) => q?.id !== payload?.id);
        filtered.push(payload);
        writeDestinationWriteQueue(filtered);
    }, []);

    const flushDestinationWriteQueue = React.useCallback(async () => {
        const queue = readDestinationWriteQueue();
        if (!queue.length) return { flushed: 0, failed: 0 };

        const failed = [];
        let flushed = 0;
        for (const payload of queue) {
            try {
                const { error } = await supabase
                    .from('destinations')
                    .upsert(payload);
                if (error) throw error;
                flushed += 1;
            } catch (_err) {
                failed.push(payload);
            }
        }
        writeDestinationWriteQueue(failed);
        return { flushed, failed: failed.length };
    }, []);

    React.useEffect(() => {
        const onUnhandledError = (event) => {
            const message = event?.error?.message || event?.message || 'Unexpected runtime error';
            showSystemPopup({
                title: 'Unexpected Error',
                message: 'The system encountered an unexpected issue.',
                details: message,
                tone: 'error',
            });
        };
        const onUnhandledRejection = (event) => {
            const reason = event?.reason;
            const message = reason?.message || (typeof reason === 'string' ? reason : 'Unhandled async error');
            showSystemPopup({
                title: 'Async Error',
                message: 'An asynchronous task failed unexpectedly.',
                details: message,
                tone: 'error',
            });
        };

        window.addEventListener('error', onUnhandledError);
        window.addEventListener('unhandledrejection', onUnhandledRejection);
        return () => {
            window.removeEventListener('error', onUnhandledError);
            window.removeEventListener('unhandledrejection', onUnhandledRejection);
        };
    }, [showSystemPopup]);

    React.useEffect(() => {
        // Simulate initial loading for a premium feel
        const timer = setTimeout(() => {
            setIsLoading(false);
        }, 2500);

        const fetchAllData = async () => {
            try {
                // Fetch Destinations
                const { data: destData, error: destError } = await supabase.from('destinations').select('*');
                if (!destError && destData) {
                    const dbPlacesMap = {};
                    const newCustomPlaces = [];
                    const restoreQueue = [];
                    let backupMap = {};
                    try {
                        const rawBackup = localStorage.getItem(SUB_PLACES_BACKUP_KEY) || '{}';
                        const parsed = JSON.parse(rawBackup);
                        if (parsed && typeof parsed === 'object') backupMap = parsed;
                    } catch (_err) {
                        backupMap = {};
                    }
                    const nextBackupMap = { ...backupMap };

                    destData.forEach(dbPlace => {
                        const seedPlace = places.find((p) => p.id === dbPlace.id);
                        const dbSubPlaces = sanitizeLegacyKandySubPlaces(dbPlace.id, dbPlace.sub_places);
                        const backupSubPlaces = sanitizeLegacyKandySubPlaces(dbPlace.id, backupMap[dbPlace.id]);
                        const seedSubPlaces = sanitizeLegacyKandySubPlaces(dbPlace.id, seedPlace?.subPlaces);
                        const resolvedSubPlaces = sanitizeLegacyKandySubPlaces(dbPlace.id, mergeSubPlacesByName(
                            dbSubPlaces,
                            backupSubPlaces,
                            seedSubPlaces,
                        ));

                        const formattedPlace = {
                            ...dbPlace,
                            subPlaces: resolvedSubPlaces,
                        };

                        dbPlacesMap[dbPlace.id] = formattedPlace;
                        if (resolvedSubPlaces.length > 0) {
                            nextBackupMap[dbPlace.id] = resolvedSubPlaces;
                        }
                        const dbNeedsRestore =
                            resolvedSubPlaces.length > 0
                            && JSON.stringify(dbSubPlaces) !== JSON.stringify(resolvedSubPlaces);
                        if (dbNeedsRestore) {
                            restoreQueue.push({ id: dbPlace.id, sub_places: resolvedSubPlaces });
                        }

                        if (String(dbPlace.id).startsWith('custom-')) {
                            newCustomPlaces.push({
                                ...formattedPlace,
                                image: dbPlace.image_url,
                                image2: dbPlace.image_url_2
                            });
                        }
                    });

                    // Update standard places list with db overrides
                    setPlacesList(prev => prev.map(pl => {
                        if (dbPlacesMap[pl.id]) {
                            const dbP = dbPlacesMap[pl.id];
                            return {
                                ...pl,
                                name: dbP.name || pl.name,
                                title: dbP.title || pl.title,
                                description: dbP.description || pl.description,
                                subPlaces: (dbP.subPlaces && dbP.subPlaces.length > 0
                                    ? sanitizeLegacyKandySubPlaces(pl.id, dbP.subPlaces)
                                    : sanitizeLegacyKandySubPlaces(pl.id, pl.subPlaces)),
                                image: dbP.image_url || pl.image,
                                image2: dbP.image_url_2 || pl.image2,
                            };
                        }
                        const seedSubPlaces = sanitizeLegacyKandySubPlaces(pl.id, pl.subPlaces);
                        if (seedSubPlaces.length > 0) {
                            nextBackupMap[pl.id] = seedSubPlaces;
                        }
                        return {
                            ...pl,
                            subPlaces: seedSubPlaces,
                        };
                    }));

                    if (newCustomPlaces.length > 0) {
                        setUserPlaces(newCustomPlaces);
                    }

                    try {
                        localStorage.setItem(SUB_PLACES_BACKUP_KEY, JSON.stringify(nextBackupMap));
                    } catch (_err) {
                        // Ignore localStorage errors.
                    }

                    if (restoreQueue.length > 0) {
                        await Promise.all(
                            restoreQueue.map(async (row) => {
                                const { error } = await supabase
                                    .from('destinations')
                                    .update({ sub_places: row.sub_places })
                                    .eq('id', row.id);
                                if (error) {
                                    throw error;
                                }
                            })
                        );
                    }

                    await flushDestinationWriteQueue();
                }


            } catch (err) {
                console.error("Error fetching initial data", err);
                showSystemPopup({
                    title: 'Loading Error',
                    message: 'Initial data could not be loaded.',
                    details: err?.message || 'Please refresh and try again.',
                    tone: 'error',
                });

            }
        };

        fetchAllData();

        return () => clearTimeout(timer);
    }, [showSystemPopup, flushDestinationWriteQueue]);


    const [placesList, setPlacesList] = useState(() => {
        return places.map(p => {
            const cleanedSubPlaces = sanitizeLegacyKandySubPlaces(p.id, p.subPlaces);
            const galleryImages = galleryDataRaw[p.id] || [];
            if (galleryImages.length > 0) {
                return {
                    ...p,
                    subPlaces: cleanedSubPlaces,
                    image: galleryImages[0],
                    image2: galleryImages.length > 1 ? galleryImages[1] : null
                };
            }
            return {
                ...p,
                subPlaces: cleanedSubPlaces,
            };
        });
    });
    const [newPlace, setNewPlace] = useState({
        name: '',
        title: '',
        description: '',
        alternativeDescription: '',
        activeDescriptionSource: 'default',
        image: null,
        image2: null,
        subPlaces: []
    });
    const [isDefaultDescriptionLocked, setIsDefaultDescriptionLocked] = useState(true);
    const [newSubPlace, setNewSubPlace] = useState({ name: '', description: '' });
    const [newDayPoint, setNewDayPoint] = useState('');
    const [newCityPoint, setNewCityPoint] = useState('');
    const [editingSubPlaceIdx, setEditingSubPlaceIdx] = useState(null);
    const [editingSubValue, setEditingSubValue] = useState({ name: '', description: '' });
    const [editingDayPointIdx, setEditingDayPointIdx] = useState(null);
    const [editingDayPointValue, setEditingDayPointValue] = useState('');
    const [editingCityPointIdx, setEditingCityPointIdx] = useState(null);
    const [editingCityPointValue, setEditingCityPointValue] = useState('');
    const [showPlaceForm, setShowPlaceForm] = useState(false);
    const [editingPlaceId, setEditingPlaceId] = useState(null);
    const [placesGallery, setPlacesGallery] = useState(galleryDataRaw);
    const [supabaseIsAdmin, setSupabaseIsAdmin] = useState(false);
    const [sessionRole, setSessionRole] = useState(() => {
        try {
            return localStorage.getItem(LOGIN_ROLE_KEY) || '';
        } catch (_err) {
            return '';
        }
    });
    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const isAdmin = sessionRole === 'admin' || supabaseIsAdmin;
    const pdfRef = useRef();

    React.useEffect(() => {
        const adminEmails = (import.meta.env.VITE_ADMIN_EMAILS || '')
            .split(',')
            .map(v => v.trim().toLowerCase())
            .filter(Boolean);

        const resolveAdmin = (user) => {
            if (!user) return false;
            const role = (user.app_metadata?.role || user.user_metadata?.role || '').toString().toLowerCase();
            const email = (user.email || '').toLowerCase();
            return role === 'admin' || (email && adminEmails.includes(email));
        };

        let authSub;
        supabase.auth.getSession().then(({ data }) => {
            setSupabaseIsAdmin(resolveAdmin(data?.session?.user || null));
        }).catch(() => {
            setSupabaseIsAdmin(false);
        });

        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
            setSupabaseIsAdmin(resolveAdmin(session?.user || null));
        });
        authSub = data?.subscription;

        return () => {
            if (authSub) authSub.unsubscribe();
        };
    }, []);

    React.useEffect(() => {
        try {
            if (sessionRole) {
                localStorage.setItem(LOGIN_ROLE_KEY, sessionRole);
            } else {
                localStorage.removeItem(LOGIN_ROLE_KEY);
            }
        } catch (_err) {
            // Ignore localStorage errors.
        }
    }, [sessionRole]);

    const handleLocalLogin = (e) => {
        e.preventDefault();
        const username = loginUsername.trim().toLowerCase();
        const password = loginPassword;
        const expectedPassword = LOCAL_LOGIN_CREDENTIALS[username];

        if (!expectedPassword || password !== expectedPassword) {
            setLoginError('Invalid username or password.');
            return;
        }

        setSessionRole(username);
        setLoginUsername('');
        setLoginPassword('');
        setLoginError('');
    };

    const handleLogout = () => {
        setSessionRole('');
        setLoginUsername('');
        setLoginPassword('');
        setLoginError('');
    };

    const calculateTourHeading = () => {
        if (!arrivalDate || !departureDate) return "";
        const start = new Date(arrivalDate);
        const end = new Date(departureDate);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        const nights = diffDays - 1;

        const nightsStr = nights.toString().padStart(2, '0');
        const daysStr = diffDays.toString().padStart(2, '0');

        return `${nightsStr} NIGHTS ${daysStr} DAYS TOUR ITINERARY TO SRI LANKA`;
    };

    const handleNumDaysChange = (val) => {
        const days = Math.max(1, Math.min(30, parseInt(val) || 1));
        setNumDays(days);
        setItinerary(prev => {
            const next = { ...prev };
            for (let i = 1; i <= days; i++) {
                if (!next[i]) next[i] = [];
            }
            // Remove days that are no longer part of the itinerary
            for (let i = days + 1; i in next; i++) {
                delete next[i];
            }
            return next;
        });
        if (activeDay > days) setActiveDay(days);
    };

    React.useEffect(() => {
        if (useTravelDates && arrivalDate && departureDate) {
            const start = new Date(arrivalDate);
            const end = new Date(departureDate);
            const diffTime = Math.abs(end - start);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
            if (diffDays > 0) {
                handleNumDaysChange(diffDays);
            }
        }
    }, [useTravelDates, arrivalDate, departureDate]);

    React.useEffect(() => {
        if (!useTravelDates) {
            const parsedDays = Math.max(1, Math.min(30, parseInt(manualDaysCount, 10) || 1));
            if (parsedDays !== numDays) {
                handleNumDaysChange(parsedDays);
            }
        }
    }, [useTravelDates, manualDaysCount]);

    const manualDaysValid = Number.isFinite(Number(manualDaysCount)) && Number(manualDaysCount) >= 1;
    const manualNightsValid = Number.isFinite(Number(manualNightsCount)) && Number(manualNightsCount) >= 0;
    const allPlaces = [...placesList, ...userPlaces];

    const canStartBuilding =
        (useTravelDates
            ? (Boolean(arrivalDate) && Boolean(departureDate))
            : (manualDaysValid && manualNightsValid)) &&
        Boolean(tripStart.trim()) &&
        Boolean(tripEnd.trim());

    const getCityOptionPriority = (place) => {
        const id = String(place?.id || '').toLowerCase();
        const name = String(place?.name || '').toLowerCase();
        const title = String(place?.title || '').toLowerCase();
        const text = `${id} ${name} ${title}`;

        const isAirportArrival =
            id === 'airport-arrival'
            || text.includes('airport-arrival')
            || (text.includes('airport') && text.includes('arrival'));
        if (isAirportArrival) return 0;

        const isAirportDeparture =
            id === 'airport-departure'
            || text.includes('airport-departure')
            || text.includes('arport-dipature')
            || (text.includes('airport') && text.includes('departure'));
        if (isAirportDeparture) return 1;

        return 2;
    };

    const sortedCityOptions = [...allPlaces].sort((a, b) => {
        const pa = getCityOptionPriority(a);
        const pb = getCityOptionPriority(b);
        if (pa !== pb) return pa - pb;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
    });

    const getSetupMissingFields = () => {
        const missing = [];
        if (useTravelDates) {
            if (!arrivalDate) missing.push('Arrival Date');
            if (!departureDate) missing.push('Departure Date');
        } else {
            if (!manualDaysValid) missing.push('Number of Days');
            if (!manualNightsValid) missing.push('Number of Nights');
        }
        if (!tripStart.trim()) missing.push('Trip Start Point');
        if (!tripEnd.trim()) missing.push('Trip End Point');
        return missing;
    };

    const handleStartBuildingClick = () => {
        const missing = getSetupMissingFields();
        if (missing.length > 0) {
            showSystemPopup({
                title: 'Missing Required Fields',
                message: 'Please fill all required trip setup fields before continuing.',
                details: `Required: ${missing.join(', ')}`,
                tone: 'warning',
            });
            return;
        }
        setCurrentStep(3);
    };

    const togglePlace = (place) => {
        setItinerary(prev => {
            const currentDayPlaces = prev[activeDay] || [];
            const alreadySelected = currentDayPlaces.find(p => p.id === place.id);

            return {
                ...prev,
                [activeDay]: alreadySelected
                    ? currentDayPlaces.filter(p => p.id !== place.id)
                    : [...currentDayPlaces, { ...place, selectedSubPlaces: [], citySpecialNote: '' }]
            };
        });
    };



    const handleAddPlace = async () => {
        if (!newPlace.name || !newPlace.description || !newPlace.image) {
            showSystemPopup({
                title: 'Missing Required Fields',
                message: 'Please provide place name, description and image.',
                tone: 'warning',
            });
            return;
        }
        const normalizedSubPlaces = normalizeSubPlaces(newPlace.subPlaces);
        const normalizedPlace = {
            ...newPlace,
            subPlaces: normalizedSubPlaces
        };

        const persistedPlaceId = editingPlaceId || `custom-${Date.now()}`;

        if (editingPlaceId) {
            // Edit existing

            // Sync to Supabase in the background
            try {
                const { error } = await supabase.from('destinations').upsert({
                    id: editingPlaceId,
                    name: normalizedPlace.name,
                    title: normalizedPlace.title,
                    description: normalizedPlace.description,
                    image_url: normalizedPlace.image,
                    image_url_2: normalizedPlace.image2,
                    sub_places: normalizedSubPlaces
                });
                if (error) {
                    throw error;
                }
            } catch (e) {
                console.error("Failed to update Supabase", e);
                enqueueDestinationWrite({
                    id: editingPlaceId,
                    name: normalizedPlace.name,
                    title: normalizedPlace.title,
                    description: normalizedPlace.description,
                    image_url: normalizedPlace.image,
                    image_url_2: normalizedPlace.image2,
                    sub_places: normalizedSubPlaces,
                });
                showSystemPopup({
                    title: 'Backend Update Failed',
                    message: 'Backend update failed now. Change is queued and will auto-sync later.',
                    details: e?.message || '',
                    tone: 'error',
                });
            }

            const updateFn = (list) => list.map(p => p.id === editingPlaceId ? { ...normalizedPlace, id: editingPlaceId } : p);

            if (editingPlaceId.toString().startsWith('custom-')) {
                setUserPlaces(updateFn);
            } else {
                setPlacesList(updateFn);
            }

            // Sync with itinerary object to ensure the updated name/title/description/subPlaces show up in PDF
            setItinerary(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(day => {
                    next[day] = next[day].map(p => {
                        if (p.id === editingPlaceId) {
                            // Find matching objects in new subPlaces for currently selected ones
                            const updatedSelected = (p.selectedSubPlaces || []).map(currentSelected => {
                                const currentName = typeof currentSelected === 'string' ? currentSelected : currentSelected.name;
                                const match = (normalizedSubPlaces || []).find(sp => (typeof sp === 'string' ? sp : sp.name) === currentName);
                                return match || currentSelected;
                            });
                            return { ...normalizedPlace, id: editingPlaceId, selectedSubPlaces: updatedSelected, citySpecialNote: p.citySpecialNote || '' };
                        }
                        return p;
                    });
                });
                return next;
            });
        } else {
            // Add new
            const id = persistedPlaceId;
            const p = { ...normalizedPlace, id };

            try {
                const { error } = await supabase.from('destinations').insert({
                    id: id,
                    name: normalizedPlace.name,
                    title: normalizedPlace.title || '',
                    description: normalizedPlace.description,
                    image_url: normalizedPlace.image,
                    image_url_2: normalizedPlace.image2,
                    sub_places: normalizedSubPlaces
                });
                if (error) {
                    throw error;
                }
            } catch (e) {
                console.error("Failed to insert into Supabase", e);
                enqueueDestinationWrite({
                    id: id,
                    name: normalizedPlace.name,
                    title: normalizedPlace.title || '',
                    description: normalizedPlace.description,
                    image_url: normalizedPlace.image,
                    image_url_2: normalizedPlace.image2,
                    sub_places: normalizedSubPlaces,
                });
                showSystemPopup({
                    title: 'Backend Save Failed',
                    message: 'Backend save failed now. New place is queued and will auto-sync later.',
                    details: e?.message || '',
                    tone: 'error',
                });
            }

            setUserPlaces(prev => [...prev, p]);
        }

        try {
            const rawBackup = localStorage.getItem(SUB_PLACES_BACKUP_KEY) || '{}';
            const parsed = JSON.parse(rawBackup);
            const nextBackup = parsed && typeof parsed === 'object' ? parsed : {};
            nextBackup[persistedPlaceId] = normalizedSubPlaces;
            localStorage.setItem(SUB_PLACES_BACKUP_KEY, JSON.stringify(nextBackup));
        } catch (_err) {
            // Ignore localStorage errors.
        }

        setNewPlace({
            name: '',
            title: '',
            description: '',
            alternativeDescription: '',
            activeDescriptionSource: 'default',
            image: null,
            image2: null,
            subPlaces: []
        });
        setIsDefaultDescriptionLocked(true);
        setShowPlaceForm(false);
        setEditingPlaceId(null);
    };

    const openEditModal = (e, place) => {
        e.stopPropagation();
        const structuredSubPlaces = normalizeSubPlaces(place.subPlaces);

        setNewPlace({
            name: place.name,
            title: place.title,
            description: place.description,
            alternativeDescription: place.alternativeDescription || '',
            activeDescriptionSource: place.activeDescriptionSource || 'default',
            image: customImages[place.id] || place.image,
            image2: customImages[`${place.id}-2`] || place.image2,
            subPlaces: structuredSubPlaces
        });
        setIsDefaultDescriptionLocked(true);
        setEditingPlaceId(place.id);
        setShowPlaceForm(true);
    };

    const handleNewPlaceImage = async (e) => {
        if (!isAdmin) {
            showSystemPopup({
                title: 'Permission Required',
                message: 'Only admin can change images.',
                tone: 'warning',
            });
            return;
        }
        const file = e.target.files[0];
        if (file) {
            const resized = await resizeImage(file);
            setNewPlace(prev => ({ ...prev, image: resized }));
        }
    };

    const handleNewPlaceImage2 = async (e) => {
        if (!isAdmin) {
            showSystemPopup({
                title: 'Permission Required',
                message: 'Only admin can change images.',
                tone: 'warning',
            });
            return;
        }
        const file = e.target.files[0];
        if (file) {
            const resized = await resizeImage(file);
            setNewPlace(prev => ({ ...prev, image2: resized }));
        }
    };


    const handleGalleryUpload = async (e) => {
        if (!isAdmin) {
            showSystemPopup({
                title: 'Permission Required',
                message: 'Only admin can add images.',
                tone: 'warning',
            });
            return;
        }
        const files = Array.from(e.target.files);
        if (files.length > 0 && editingPlaceId) {
            const galleryKey = editingPlaceId;

            // Process all files
            const resizedImages = await Promise.all(files.map(file => resizeImage(file)));

            setPlacesGallery(prev => ({
                ...prev,
                [galleryKey]: [...(prev[galleryKey] || []), ...resizedImages]
            }));
        }
    };

    const handleGalleryDelete = (imageToDelete) => {
        if (!isAdmin) {
            showSystemPopup({
                title: 'Permission Required',
                message: 'Only admin can remove images.',
                tone: 'warning',
            });
            return;
        }
        // Prevent deleting default images
        const defaultImages = galleryDataRaw[editingPlaceId] || [];
        if (defaultImages.includes(imageToDelete)) {
            showSystemPopup({
                title: 'Action Not Allowed',
                message: 'This is a default image and cannot be deleted.',
                tone: 'warning',
            });
            return;
        }

        if (editingPlaceId) {
            setPlacesGallery(prev => ({
                ...prev,
                [editingPlaceId]: (prev[editingPlaceId] || []).filter(img => img !== imageToDelete)
            }));

            if (newPlace.image === imageToDelete) setNewPlace(prev => ({ ...prev, image: null }));
            if (newPlace.image2 === imageToDelete) setNewPlace(prev => ({ ...prev, image2: null }));
        }
    };

    const setFromGallery = (imgUrl, type) => {
        if (!isAdmin) {
            showSystemPopup({
                title: 'Permission Required',
                message: 'Only admin can change selected images.',
                tone: 'warning',
            });
            return;
        }
        if (type === 'primary') {
            setNewPlace(prev => ({ ...prev, image: imgUrl }));
        } else {
            setNewPlace(prev => ({ ...prev, image2: imgUrl }));
        }
    };

    const currentGallery = editingPlaceId ? (placesGallery[editingPlaceId] || []) : [];
    const getEffectiveDescription = (placeItem) => {
        const altText = (placeItem?.alternativeDescription || '').trim();
        if (placeItem?.activeDescriptionSource === 'alternative' && altText) {
            return altText;
        }
        return placeItem?.description || '';
    };
    const paginatePlaces = () => {
        const flowItems = [];
        const safeScale = Math.max(1, Number(itineraryPdfScale) || 1);

        for (let d = 1; d <= numDays; d++) {
            const dayPlaces = itinerary[d] || [];
            dayPlaces.forEach(item => {
                const placeMaster = allPlaces.find((p) => p.id === (item.id || item.cityId));
                const mergedCitySubPlaces = sanitizeLegacyKandySubPlaces(
                    item.id || item.cityId,
                    mergeSubPlacesByName(item.subPlaces, placeMaster?.subPlaces)
                );
                const enrichedSelectedSubPlaces = sanitizeLegacyKandySubPlaces(
                    item.id || item.cityId,
                    hydrateSelectedSubPlaces(item.selectedSubPlaces, mergedCitySubPlaces)
                );
                // We split into Head (Header+Images) and Content (Description+Highlights)
                // This allows a city's text to wrap to the next page while keeping images on the first page
                flowItems.push({
                    type: 'dest-head',
                    ...item,
                    day: d,
                    destId: item.id
                });

                const paragraphs = getEffectiveDescription(item).split('\n').filter(p => p.trim());
                paragraphs.forEach((p, pIdx) => {
                    flowItems.push({
                        type: 'dest-para',
                        text: p,
                        day: d,
                        destId: item.id,
                        name: item.name
                    });
                });

                if (enrichedSelectedSubPlaces.length > 0) {
                    enrichedSelectedSubPlaces.forEach((sub, subIdx) => {
                        flowItems.push({
                            type: 'dest-highlight-point',
                            highlight: sub,
                            isFirst: subIdx === 0,
                            isLast: subIdx === enrichedSelectedSubPlaces.length - 1,
                            day: d,
                            destId: item.id,
                            name: item.name
                        });
                    });
                }

                if ((item.citySpecialNote || '').trim()) {
                    const cityNoteLines = item.citySpecialNote
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean);
                    cityNoteLines.forEach((line, lineIdx) => {
                        flowItems.push({
                            type: 'city-note-point',
                            text: line,
                            isFirst: lineIdx === 0,
                            isLast: lineIdx === cityNoteLines.length - 1,
                            day: d,
                            destId: item.id,
                            name: item.name
                        });
                    });
                }
            });

            if (showDayNote[d] && dayNoteText[d]) {
                flowItems.push({ day: d, text: dayNoteText[d], type: 'dayNote', id: `day-note-${d}` });
            }
        }

        const getItemWeight = (item) => {
            let weight = 0;
            if (item.type === 'dayNote') {
                const linesRaw = (item.text || '').split('\n').filter(l => l.trim());
                weight = 0.42 + (linesRaw.length * 0.16);
            } else if (item.type === 'dest-head') {
                weight = 1.08;
                if (item.image2) weight += 0.18;
            } else if (item.type === 'dest-para') {
                weight = Math.max(0.06, (item.text || '').length / 1200);
            } else if (item.type === 'dest-highlight-point') {
                const sub = item.highlight;
                const subName = typeof sub === 'string' ? sub : (sub?.name || '');
                const subDesc = typeof sub === 'string' ? '' : (sub?.description || '');
                const pointLen = (subName + ' ' + subDesc).trim().length;
                const estimatedLines = Math.max(1, Math.ceil(pointLen / 68));
                weight = Math.max(0.38, 0.22 + (pointLen / 520) + (estimatedLines * 0.09));
            } else if (item.type === 'city-note-point') {
                const noteLen = (item.text || '').trim().length;
                // First city-note line also carries the visual box title/container overhead.
                if (item.isFirst) {
                    const estimatedLines = Math.max(1, Math.ceil(noteLen / 70));
                    weight = Math.max(0.56, 0.34 + (noteLen / 460) + (estimatedLines * 0.08));
                } else {
                    const estimatedLines = Math.max(1, Math.ceil(noteLen / 70));
                    weight = Math.max(0.34, 0.2 + (noteLen / 560) + (estimatedLines * 0.05));
                }
            }
            return weight;
        };

        const MM_PER_WEIGHT = 46;
        const FIRST_PAGE_WELCOME_RESERVE_MM = 20;
        const ENTRY_GAP_MM = 2;
        const FOOTER_SAFETY_CLEARANCE_MM = 2;
        const planner = new TypeScriptPdfLayoutEngine({
            page: { width: 210, height: 297 },
            margins: { top: 5, right: 5, bottom: 2, left: 5 },
            headerHeightMm: 52,
            // Reserve 2mm safety clearance above the visible footer area.
            footerHeightMm: 20 + FOOTER_SAFETY_CLEARANCE_MM,
            blockGapMm: ENTRY_GAP_MM,
            footerVisibility: 'last-and-single',
        });

        const entries = [];
        for (let i = 0; i < flowItems.length; i++) {
            const current = flowItems[i];
            const next = flowItems[i + 1];

            const canPairHead =
                current.type === 'dest-head'
                && next
                && next.destId === current.destId
                && next.type === 'dest-para';

            if (canPairHead) {
                const pairWeight = getItemWeight(current) + getItemWeight(next);
                entries.push({
                    id: `entry-${i}`,
                    itemIndexes: [i, i + 1],
                    heightMm: Math.max(12, (pairWeight * MM_PER_WEIGHT * safeScale) + ENTRY_GAP_MM),
                    keepTogether: true,
                });
                i += 1;
                continue;
            }

            entries.push({
                id: `entry-${i}`,
                itemIndexes: [i],
                heightMm: Math.max(8, getItemWeight(current) * MM_PER_WEIGHT * safeScale),
                keepTogether: true,
            });
        }

        const blocks = [
            {
                id: 'engine-first-page-reserve',
                heightMm: FIRST_PAGE_WELCOME_RESERVE_MM,
                keepTogether: true,
                splittable: false,
            },
            ...entries.map((entry) => ({
                id: entry.id,
                heightMm: entry.heightMm,
                forcePageBreak: entry.forcePageBreak === true,
                keepTogether: entry.keepTogether,
                splittable: false,
            })),
        ];

        let plan;
        try {
            plan = planner.layout(blocks);
        } catch (_err) {
            return [{ items: flowItems, showHeader: true, showFooter: true, footerExceptionApplied: false }];
        }
        if (!plan.valid) {
            return [{ items: flowItems, showHeader: true, showFooter: true, footerExceptionApplied: false }];
        }

        const entryById = new Map(entries.map((entry) => [entry.id, entry]));
        const pages = plan.pages.map((page) => {
            const pageItems = [];
            page.blocks.forEach((block) => {
                if (block.sourceId === 'engine-first-page-reserve') return;
                const entry = entryById.get(block.sourceId);
                if (!entry) return;
                entry.itemIndexes.forEach((idx) => {
                    const item = flowItems[idx];
                    if (item) pageItems.push(item);
                });
            });
            return {
                items: pageItems,
                showHeader: page.showHeader,
                showFooter: page.showFooter,
                footerExceptionApplied: Boolean(page.footerExceptionApplied),
            };
        });

        return pages.length > 0 ? pages : [{ items: [], showHeader: true, showFooter: true, footerExceptionApplied: false }];
    };

    const pagesData = paginatePlaces();
    const [isPdfReady, setIsPdfReady] = useState(false);
    const waitForRenderTick = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForFontsAndImages = async (container) => {
        if (typeof document !== 'undefined' && document.fonts?.ready) {
            try {
                await document.fonts.ready;
            } catch {
                // Ignore and continue.
            }
        }
        const images = Array.from(container.querySelectorAll('img'));
        if (images.length === 0) return;
        await Promise.all(images.map((img) => new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
                resolve();
                return;
            }
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
        })));
    };

    const openPreviewWithValidation = async () => {
        if (isPreparingPreview || isGenerating) return;
        setIsPreparingPreview(true);
        let scale = 1;
        let passed = false;
        let lastError = null;

        try {
            if (itineraryPdfScale !== 1) {
                setItineraryPdfScale(1);
            }
            await waitForRenderTick(240);

            for (let attempt = 0; attempt < 10; attempt++) {
                if (attempt > 0) {
                    scale = Number((scale * 1.05).toFixed(3));
                    setItineraryPdfScale(scale);
                    await waitForRenderTick(260);
                }

                const container = document.getElementById('hidden-pdf-content');
                if (!container) {
                    throw new Error('Preview container not found');
                }

                try {
                    await waitForFontsAndImages(container);
                    ensurePdfLayoutValid(container, 'Itinerary Preview');
                    passed = true;
                    setShowPreview(true);
                    return;
                } catch (err) {
                    lastError = err;
                    const msg = String(err?.message || '').toLowerCase();
                    const isLayoutIssue =
                        msg.includes('layout validation failed')
                        || msg.includes('bottom safety limit')
                        || msg.includes('footer safety')
                        || msg.includes('printable border')
                        || msg.includes('overlaps');
                    if (!isLayoutIssue) throw err;
                }
            }

            throw lastError || new Error('Preview layout validation failed');
        } catch (error) {
            showSystemPopup({
                title: 'Preview Validation Failed',
                message: 'Could not safely layout preview within the 2mm bottom limit.',
                details: error?.message || '',
                tone: 'error',
            });
        } finally {
            setItineraryPdfScale(passed ? scale : 1);
            setIsPreparingPreview(false);
        }
    };

    const generatePDF = async (forcedRouteMapSnapshot = '', forceAttachRoutePlan = false) => {
        const safeForcedSnapshot = typeof forcedRouteMapSnapshot === 'string' ? forcedRouteMapSnapshot : '';
        const safeForceAttach = forceAttachRoutePlan === true;
        setIsGenerating(true);
        setGenerationTime(new Date().toLocaleString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }));
        // PDF generation logic below - no backend saving for itineraries per request

        // Higher delay to ensure all dynamic content and images are fully rendered
        setTimeout(async () => {
            try {
                let scale = 1;
                let lastError = null;
                if (itineraryPdfScale !== 1) {
                    setItineraryPdfScale(1);
                    await waitForRenderTick(220);
                }

                for (let attempt = 0; attempt < 10; attempt++) {
                    if (attempt > 0) {
                        scale = Number((scale * 1.05).toFixed(3));
                        setItineraryPdfScale(scale);
                        await waitForRenderTick(220);
                    }

                    try {
                        const result = await generateItineraryPdf({
                            containerId: 'hidden-pdf-content',
                            routeMapPlan,
                            routeMapPlanRefCurrent: routeMapPlanRef.current,
                            forcedRouteMapSnapshot: safeForcedSnapshot,
                            forceAttachRoutePlan: safeForceAttach,
                            routeMapSnapshotKey: ROUTE_MAP_SNAPSHOT_KEY,
                            setRouteMapPlan,
                        });

                        if (result === 'container-missing') {
                            showSystemPopup({
                                title: 'PDF Error',
                                message: 'PDF container was not found.',
                                details: 'Please reopen preview and try again.',
                                tone: 'error',
                            });
                            return;
                        }
                        if (result === 'no-content') {
                            showSystemPopup({
                                title: 'No Itinerary Content',
                                message: 'Please add some places to the itinerary first.',
                                tone: 'warning',
                            });
                            return;
                        }

                        setItineraryPdfScale(scale);
                        return;
                    } catch (attemptError) {
                        lastError = attemptError;
                        const msg = String(attemptError?.message || '').toLowerCase();
                        const isLayoutValidationFailure =
                            msg.includes('layout validation failed');
                        const isBottomSafetyFailure =
                            msg.includes('bottom safety limit')
                            || msg.includes('footer safety clearance')
                            || msg.includes('overlaps footer')
                            || msg.includes('printable border');
                        if (!isBottomSafetyFailure && !isLayoutValidationFailure) {
                            throw attemptError;
                        }
                    }
                }

                if (lastError) throw lastError;
            } catch (error) {
                console.error(error);
                showSystemPopup({
                    title: 'PDF Generation Failed',
                    message: 'Error generating PDF. Please try again.',
                    details: error?.message || '',
                    tone: 'error',
                });
            } finally {
                if (!showPreview) {
                    setItineraryPdfScale(1);
                }
                setIsGenerating(false);
            }
        }, 1500);
    };

    const buildCityPdfPlace = (sourcePlace, selectedIndexes = null) => {
        const allSubPlaces = Array.isArray(sourcePlace?.allSubPlaces)
            ? sourcePlace.allSubPlaces
            : (Array.isArray(sourcePlace?.subPlaces) ? sourcePlace.subPlaces : []);
        const defaultIndexes = allSubPlaces.map((_, idx) => idx);
        const safeIndexes = Array.isArray(selectedIndexes) ? selectedIndexes : defaultIndexes;
        const selectedSet = new Set(safeIndexes);
        const selectedSubPlaces = allSubPlaces.filter((_, idx) => selectedSet.has(idx));

        return {
            ...sourcePlace,
            allSubPlaces,
            subPlaces: selectedSubPlaces,
            effectiveDescription: sourcePlace?.effectiveDescription || getEffectiveDescription(sourcePlace)
        };
    };

    const openCityPreview = (place) => {
        if (!place) return;
        const allSubPlaces = Array.isArray(place?.subPlaces) ? place.subPlaces : [];
        const allIndexes = allSubPlaces.map((_, idx) => idx);
        setCityPdfSelectedSubIndexes(allIndexes);
        setCityPdfPlace(buildCityPdfPlace({ ...place, allSubPlaces }, allIndexes));
        setShowCityPreview(true);
    };

    const closeCityPreview = () => {
        setShowCityPreview(false);
        if (!isGeneratingCityPdf) {
            setCityPdfPlace(null);
            setCityPdfSelectedSubIndexes([]);
        }
    };

    const backToMenu = () => {
        setShowPreview(false);
        setShowCityPreview(false);
        setShowPlaceForm(false);
        setCurrentStep(1);
    };

    const generateCityPDF = async (placeParam = null) => {
        if (!placeParam && !cityPdfPlace) return;
        const sourcePlace = placeParam || cityPdfPlace;
        const preparedPlace = placeParam
            ? buildCityPdfPlace({ ...placeParam, allSubPlaces: Array.isArray(placeParam?.subPlaces) ? placeParam.subPlaces : [] })
            : buildCityPdfPlace(sourcePlace, cityPdfSelectedSubIndexes);
        setCityPdfPlace(preparedPlace);
        setIsGeneratingCityPdf(true);

        setTimeout(async () => {
            try {
                await downloadCityPdfFromContainer(CITY_PDF_CONTAINER_ID, preparedPlace.name);
            } catch (error) {
                console.error(error);
                showSystemPopup({
                    title: 'City PDF Generation Failed',
                    message: 'Error generating city PDF. Please try again.',
                    details: error?.message || '',
                    tone: 'error',
                });
            } finally {
                setIsGeneratingCityPdf(false);
                if (!showCityPreview) {
                    setCityPdfPlace(null);
                    setCityPdfSelectedSubIndexes([]);
                }
            }
        }, 700);
    };

    const toggleCitySubPlace = (index) => {
        if (!cityPdfPlace) return;
        const nextIndexes = cityPdfSelectedSubIndexes.includes(index)
            ? cityPdfSelectedSubIndexes.filter(i => i !== index)
            : [...cityPdfSelectedSubIndexes, index];
        setCityPdfSelectedSubIndexes(nextIndexes);
        setCityPdfPlace(prev => buildCityPdfPlace(prev, nextIndexes));
    };

    const selectAllCitySubPlaces = () => {
        if (!cityPdfPlace) return;
        const allIndexes = (cityPdfPlace.allSubPlaces || []).map((_, idx) => idx);
        setCityPdfSelectedSubIndexes(allIndexes);
        setCityPdfPlace(prev => buildCityPdfPlace(prev, allIndexes));
    };

    const clearAllCitySubPlaces = () => {
        if (!cityPdfPlace) return;
        setCityPdfSelectedSubIndexes([]);
        setCityPdfPlace(prev => buildCityPdfPlace(prev, []));
    };

    const totalSelected = Object.values(itinerary).reduce((acc, curr) => acc + curr.length, 0);
    const activeDayCities = itinerary[activeDay] || [];
    const selectedCityIndexRaw = Number(selectedCityForNote[activeDay] ?? 0);
    const selectedCityIndex = Number.isFinite(selectedCityIndexRaw)
        ? Math.min(Math.max(0, selectedCityIndexRaw), Math.max(0, activeDayCities.length - 1))
        : 0;
    const selectedCityItemForNote = activeDayCities[selectedCityIndex] || null;
    const selectedCityMaster = selectedCityItemForNote
        ? allPlaces.find(p => p.id === (selectedCityItemForNote.id || selectedCityItemForNote.cityId))
        : null;
    const selectedCityNoteText = selectedCityItemForNote?.citySpecialNote || '';

    const updateSelectedCityNote = (nextTextUpdater) => {
        if (!selectedCityItemForNote) return;
        const itemId = selectedCityItemForNote.id || selectedCityItemForNote.cityId;
        setItinerary(prev => {
            const nextDay = [...(prev[activeDay] || [])];
            const itemIdx = nextDay.findIndex(p => (p.id || p.cityId) === itemId);
            if (itemIdx === -1) return prev;
            const currentText = nextDay[itemIdx]?.citySpecialNote || '';
            const nextText = typeof nextTextUpdater === 'function' ? nextTextUpdater(currentText) : nextTextUpdater;
            nextDay[itemIdx] = { ...nextDay[itemIdx], citySpecialNote: nextText };
            return { ...prev, [activeDay]: nextDay };
        });
    };

    if (!isLoading && !sessionRole) {
        return (
            <div className="app">
                <main className="container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', paddingTop: '40px', paddingBottom: '40px' }}>
                    <div style={{ width: '100%', maxWidth: '460px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', boxShadow: '0 10px 25px rgba(2,6,23,0.08)', padding: '28px' }}>
                        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                            <img src="/logo.png" alt="Invel Holidays Logo" style={{ width: '190px', maxWidth: '100%', marginBottom: '12px' }} />
                            <h1 style={{ margin: 0, color: 'var(--primary)', fontSize: '1.45rem' }}>Login</h1>
                            <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '0.9rem' }}>Use `admin/admin` or `user/user`.</p>
                        </div>

                        <form onSubmit={handleLocalLogin}>
                            <div className="form-group">
                                <label>Username</label>
                                <input
                                    type="text"
                                    className="modern-input"
                                    value={loginUsername}
                                    onChange={(e) => setLoginUsername(e.target.value)}
                                    autoComplete="username"
                                    placeholder="admin or user"
                                />
                            </div>
                            <div className="form-group">
                                <label>Password</label>
                                <input
                                    type="password"
                                    className="modern-input"
                                    value={loginPassword}
                                    onChange={(e) => setLoginPassword(e.target.value)}
                                    autoComplete="current-password"
                                    placeholder="Enter password"
                                />
                            </div>
                            {loginError && (
                                <div style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: '10px' }}>{loginError}</div>
                            )}
                            <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: '6px' }}>
                                Login
                            </button>
                        </form>
                    </div>
                </main>
                <Analytics />
            </div>
        );
    }

    return (
        <div className="app">
            <AnimatePresence>
                {isLoading && (
                    <motion.div
                        key="loader"
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0, y: -20, transition: { duration: 0.8, ease: "easeInOut" } }}
                        className="app-loader"
                    >
                        <div className="loader-content">
                            {/* Floating background icons for travel feel */}
                            <motion.div
                                className="loader-bg-icon icon-1"
                                animate={{
                                    y: [0, -30, 0],
                                    opacity: [0.1, 0.4, 0.1],
                                    scale: [1, 1.1, 1],
                                    rotate: [0, 10, -10, 0]
                                }}
                                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                            ><Palmtree size={64} /></motion.div>
                            <motion.div
                                className="loader-bg-icon icon-2"
                                animate={{
                                    y: [0, 40, 0],
                                    opacity: [0.1, 0.35, 0.1],
                                    scale: [1, 1.15, 1],
                                    rotate: [0, -15, 15, 0]
                                }}
                                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                            ><Camera size={48} /></motion.div>
                            <motion.div
                                className="loader-bg-icon icon-3"
                                animate={{
                                    rotate: [0, 360],
                                    opacity: [0.1, 0.3, 0.1],
                                    scale: [1, 1.2, 1]
                                }}
                                transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                            ><Compass size={56} /></motion.div>

                            {/* Added Clouds for extra depth */}
                            <motion.div
                                className="loader-cloud cloud-1"
                                animate={{ x: [-200, 800], opacity: [0, 0.3, 0] }}
                                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                            ><Cloud size={100} /></motion.div>
                            <motion.div
                                className="loader-cloud cloud-2"
                                animate={{ x: [800, -200], opacity: [0, 0.2, 0] }}
                                transition={{ duration: 25, repeat: Infinity, ease: "linear", delay: 5 }}
                            ><Cloud size={80} /></motion.div>

                            <motion.div
                                animate={{
                                    scale: [1, 1.05, 1],
                                    opacity: [0.8, 1, 0.8]
                                }}
                                transition={{
                                    duration: 2,
                                    repeat: Infinity,
                                    ease: "easeInOut"
                                }}
                                className="loader-logo-container"
                                style={{ position: 'relative', overflow: 'hidden' }}
                            >
                                <img src="/logo.png" alt="Invel Holidays" className="loader-logo" />
                                <motion.div
                                    className="logo-glint"
                                    animate={{ left: ['-100%', '200%'] }}
                                    transition={{ duration: 3, repeat: Infinity, ease: "linear", delay: 1 }}
                                />
                            </motion.div>
                            <div className="loader-bar-container" style={{ position: 'relative', overflow: 'visible' }}>
                                <motion.div
                                    initial={{ width: "0%" }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 2, ease: "easeInOut" }}
                                    className="loader-bar"
                                />

                                {/* Plane Trail */}
                                <motion.div
                                    initial={{ width: "0%" }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 2, ease: "easeInOut" }}
                                    className="plane-trail"
                                />

                                <motion.div
                                    initial={{ left: "0%" }}
                                    animate={{ left: "100%" }}
                                    transition={{ duration: 2, ease: "easeInOut" }}
                                    style={{
                                        position: 'absolute',
                                        top: '-15px',
                                        transform: 'translateX(-50%)',
                                        color: 'var(--primary)',
                                        zIndex: 10,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                >
                                    <motion.div
                                        animate={{
                                            y: [0, -4, 0],
                                            rotate: [0, -2, 2, 0]
                                        }}
                                        transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
                                    >
                                        <Plane size={32} style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))' }} fill="var(--primary)" />
                                    </motion.div>
                                </motion.div>
                            </div>
                            <motion.p
                                initial={{ opacity: 0, letterSpacing: "5px" }}
                                animate={{ opacity: 1, letterSpacing: "2px" }}
                                transition={{ delay: 0.8, duration: 1.5, ease: "easeOut" }}
                                className="loader-text"
                            >
                                Where Journeys Become Stories...
                            </motion.p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <header>
                <div className="container header-content">
                    <div className="logo-container">
                        <img src="/logo.png" alt="Invel Holidays Logo" />
                    </div>
                    <div className="header-contact">
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-light)' }}>www.invelsrilanka.com</span>
                        <span style={{ marginLeft: '12px', fontSize: '0.82rem', color: '#475569' }}>
                            {sessionRole === 'admin' ? 'Role: Admin' : 'Role: User'}
                        </span>
                        <button
                            className="btn btn-outline btn-sm"
                            type="button"
                            style={{ width: 'auto', marginTop: 0, marginLeft: '10px', padding: '6px 10px' }}
                            onClick={handleLogout}
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            <main className="container">
                <div className="main-layout">
                    <section className="selection-area" style={{ flex: 1 }}>
                        <AnimatePresence mode="wait">
                            {currentStep === 1 ? (
                                <motion.div
                                    key="step1"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    className="setup-step"
                                >
                                    <h1 className="section-title">Trip Configuration</h1>
                                    <p style={{ marginBottom: '30px', color: 'var(--text-light)' }}>
                                        Set your travel dates and starting points to begin building your itinerary.
                                    </p>

                                    <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '22px', padding: '14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '0.9rem', textTransform: 'none', letterSpacing: 0 }}>
                                            <input
                                                type="checkbox"
                                                checked={useTravelDates}
                                                onChange={() => setUseTravelDates(true)}
                                            />
                                            I have arrival and departure dates
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '0.9rem', textTransform: 'none', letterSpacing: 0 }}>
                                            <input
                                                type="checkbox"
                                                checked={!useTravelDates}
                                                onChange={() => setUseTravelDates(false)}
                                            />
                                            I only know days and nights count
                                        </label>
                                    </div>

                                    <div className="setup-grid" style={{ marginTop: '20px' }}>
                                        {useTravelDates ? (
                                            <>
                                                <div className="setup-item">
                                                    <label><Calendar size={16} /> Arrival Date</label>
                                                    <input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} className="modern-input" />
                                                </div>
                                                <div className="setup-item">
                                                    <label><Calendar size={16} /> Departure Date</label>
                                                    <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} className="modern-input" />
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="setup-item">
                                                    <label><Calendar size={16} /> Number of Days</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="30"
                                                        value={manualDaysCount}
                                                        onChange={(e) => setManualDaysCount(e.target.value)}
                                                        className="modern-input"
                                                        placeholder="e.g. 7"
                                                    />
                                                </div>
                                                <div className="setup-item">
                                                    <label><Calendar size={16} /> Number of Nights</label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="29"
                                                        value={manualNightsCount}
                                                        onChange={(e) => setManualNightsCount(e.target.value)}
                                                        className="modern-input"
                                                        placeholder="e.g. 6"
                                                    />
                                                </div>
                                            </>
                                        )}
                                        <div className="setup-item">
                                            <label><MapPin size={16} /> Trip Start Point</label>
                                            <input type="text" placeholder="e.g. Colombo Airport" value={tripStart} onChange={(e) => setTripStart(e.target.value)} className="modern-input" />
                                        </div>
                                        <div className="setup-item">
                                            <label><MapPin size={16} /> Trip End Point</label>
                                            <input type="text" placeholder="e.g. Colombo Airport" value={tripEnd} onChange={(e) => setTripEnd(e.target.value)} className="modern-input" />
                                        </div>
                                        <div className="setup-item">
                                            <label><Plane size={16} /> Flight Details (Optional)</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. UL 402 | 10:45 AM | CMB to DXB"
                                                value={flightDetails}
                                                onChange={(e) => setFlightDetails(e.target.value)}
                                                className="modern-input"
                                            />
                                        </div>
                                    </div>



                                    <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'flex-end', gap: '15px' }}>
                                        <button
                                            className="btn btn-outline"
                                            onClick={() => setCurrentStep(2)}
                                            style={{ padding: '12px 30px' }}
                                        >
                                            Manage Destinations <ImageIcon size={18} style={{ marginLeft: '8px' }} />
                                        </button>
                                        <button
                                            className="btn btn-primary"
                                            type="button"
                                            onClick={handleStartBuildingClick}
                                            style={{ padding: '12px 30px' }}
                                        >
                                            Start Building Itinerary <Compass size={18} style={{ marginLeft: '8px' }} />
                                        </button>
                                    </div>
                                </motion.div>
                            ) : currentStep === 2 ? (
                                <motion.div
                                    key="step2"
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className="setup-step"
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                                        <div>
                                            <h1 className="section-title" style={{ margin: 0 }}>Destination Library</h1>
                                            <p style={{ color: 'var(--text-light)' }}>Add or update cities and their special locations.</p>
                                        </div>
                                        <button className="btn btn-outline" type="button" onClick={backToMenu}>Back to Menu</button>
                                    </div>

                                    <div className="destination-toolbar" style={{ marginBottom: '30px' }}>
                                        <input
                                            type="text"
                                            placeholder="Search existing cities..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="modern-input destination-search-input"
                                        />
                                        <button
                                            className="btn btn-primary"
                                            style={{ width: 'auto', whiteSpace: 'nowrap', padding: '12px 22px' }}
                                            onClick={() => {
                                                setEditingPlaceId(null);
                                                setNewPlace({
                                                    name: '',
                                                    title: '',
                                                    description: '',
                                                    alternativeDescription: '',
                                                    activeDescriptionSource: 'default',
                                                    image: null,
                                                    image2: null,
                                                    subPlaces: []
                                                });
                                                setIsDefaultDescriptionLocked(true);
                                                setShowPlaceForm(true);
                                            }}
                                        >
                                            <Plus size={18} /> New Destination
                                        </button>
                                    </div>

                                    <div className="picker-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                                        {allPlaces
                                            .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
                                            .map(p => (
                                                <div key={p.id} className="place-card" style={{ height: 'auto', background: 'white' }}>
                                                    <div className="place-card-image-container">
                                                        <img src={p.image} alt={p.name} className="place-card-image" />
                                                    </div>
                                                    <div className="place-card-info" style={{ padding: '20px' }}>
                                                        <h3 style={{ margin: '0 0 10px 0' }}>{p.name}</h3>
                                                        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '15px', height: '60px', overflow: 'hidden' }}>{p.description}</p>

                                                        {p.subPlaces && p.subPlaces.length > 0 && (
                                                            <div style={{ marginBottom: '15px' }}>
                                                                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--primary)', textTransform: 'uppercase' }}>Highlights:</span>
                                                                <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '5px' }}>
                                                                    {p.subPlaces.slice(0, 3).map(getSubPlaceName).filter(Boolean).join(', ')}
                                                                    {p.subPlaces.length > 3 ? '...' : ''}
                                                                </p>
                                                            </div>
                                                        )}

                                                        <button
                                                            className="btn btn-outline btn-sm"
                                                            style={{ width: '100%' }}
                                                            onClick={(e) => openEditModal(e, p)}
                                                        >
                                                            <Edit2 size={14} /> Edit Data
                                                        </button>
                                                        <button
                                                            className="btn btn-outline btn-sm"
                                                            style={{ width: '100%', marginTop: '10px' }}
                                                            onClick={() => openCityPreview(p)}
                                                        >
                                                            <Eye size={14} /> Preview City PDF
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="step3"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="builder-step"
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '35px', flexWrap: 'wrap', gap: '20px' }}>
                                        <div>
                                            <button
                                                onClick={backToMenu}
                                                type="button"
                                                className="btn btn-outline"
                                                style={{ width: 'auto', padding: '8px 16px', fontSize: '0.85rem', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}
                                            >
                                                <Compass size={16} /> Back to Dashboard
                                            </button>
                                            <h1 className="section-title" style={{ margin: 0 }}>Design Your Journey</h1>
                                        </div>

                                        <div className="day-selector-pills">
                                            {[...Array(numDays)].map((_, i) => (
                                                <button
                                                    key={i + 1}
                                                    className={`day-pill ${activeDay === i + 1 ? 'active' : ''}`}
                                                    onClick={() => setActiveDay(i + 1)}
                                                >
                                                    Day {i + 1}
                                                    {itinerary[i + 1]?.length > 0 && <span className="count-dot">{itinerary[i + 1].length}</span>}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="builder-content">
                                        <div className="builder-card">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', flexWrap: 'wrap', gap: '15px' }}>
                                                <h2 style={{ fontSize: '1.4rem', color: 'var(--primary)', margin: 0 }}>Day {activeDay} Destinations</h2>

                                                <div style={{ display: 'flex', gap: '12px' }}>
                                                    <div
                                                        className="premium-switch-container"
                                                        onClick={() => {
                                                            const checked = !showDayNote[activeDay];
                                                            setShowDayNote(prev => ({ ...prev, [activeDay]: checked }));
                                                            if (!checked) setDayNoteText(prev => ({ ...prev, [activeDay]: '' }));
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={showDayNote[activeDay] || false}
                                                            onChange={() => { }}
                                                        />
                                                        <span className="premium-switch-text">Day Notes</span>
                                                    </div>

                                                    <div
                                                        className="premium-switch-container"
                                                        onClick={() => {
                                                            const checked = !showCityNote[activeDay];
                                                            setShowCityNote(prev => ({ ...prev, [activeDay]: checked }));
                                                            if (checked && activeDayCities.length > 0 && selectedCityForNote[activeDay] == null) {
                                                                setSelectedCityForNote(prev => ({ ...prev, [activeDay]: 0 }));
                                                            }
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={showCityNote[activeDay] || false}
                                                            onChange={() => { }}
                                                        />
                                                        <span className="premium-switch-text">City Notes</span>
                                                    </div>
                                                </div>
                                            </div>


                                            <AnimatePresence>
                                                {showDayNote[activeDay] && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        className="note-builder-container day-note"
                                                    >
                                                        <div className="note-label-premium"><Cloud size={14} /> Global Day {activeDay} Highlights</div>

                                                        <div className="points-list-premium">
                                                            {(dayNoteText[activeDay] || '').split('\n').filter(p => p.trim()).map((point, pIdx) => (
                                                                <div key={pIdx} className="point-card-premium">
                                                                    {editingDayPointIdx === pIdx ? (
                                                                        <div style={{ width: '100%' }}>
                                                                            <textarea
                                                                                value={editingDayPointValue}
                                                                                onChange={(e) => setEditingDayPointValue(e.target.value)}
                                                                                className="premium-textarea-input"
                                                                                style={{ minHeight: '80px', marginBottom: '10px' }}
                                                                            />
                                                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                                                <button onClick={() => {
                                                                                    const points = (dayNoteText[activeDay] || '').split('\n');
                                                                                    points[pIdx] = editingDayPointValue.trim();
                                                                                    setDayNoteText(prev => ({ ...prev, [activeDay]: points.join('\n') }));
                                                                                    setEditingDayPointIdx(null);
                                                                                }} className="btn btn-primary btn-sm" style={{ width: 'auto' }}>Save</button>
                                                                                <button onClick={() => setEditingDayPointIdx(null)} className="btn btn-outline btn-sm" style={{ width: 'auto' }}>Cancel</button>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <div className="point-text"><span className="point-text-bullet">•</span>{point}</div>
                                                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                                                <button onClick={() => { setEditingDayPointIdx(pIdx); setEditingDayPointValue(point); }} className="premium-action-btn"><Edit2 size={14} /></button>
                                                                                <button onClick={() => {
                                                                                    const points = (dayNoteText[activeDay] || '').split('\n');
                                                                                    points.splice(pIdx, 1);
                                                                                    setDayNoteText(prev => ({ ...prev, [activeDay]: points.join('\n') }));
                                                                                }} className="premium-action-btn delete"><Trash2 size={14} /></button>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div style={{ position: 'relative' }}>
                                                            <textarea
                                                                placeholder="Add a new highlight or special instruction for this day..."
                                                                value={newDayPoint}
                                                                onChange={(e) => setNewDayPoint(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                                        e.preventDefault();
                                                                        if (!newDayPoint.trim()) return;
                                                                        setDayNoteText(prev => {
                                                                            const current = prev[activeDay] || '';
                                                                            return { ...prev, [activeDay]: current ? current + '\n' + newDayPoint.trim() : newDayPoint.trim() };
                                                                        });
                                                                        setNewDayPoint('');
                                                                    }
                                                                }}
                                                                className="premium-textarea-input"
                                                                style={{ minHeight: '100px' }}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    if (!newDayPoint.trim()) return;
                                                                    setDayNoteText(prev => {
                                                                        const current = prev[activeDay] || '';
                                                                        return { ...prev, [activeDay]: current ? current + '\n' + newDayPoint.trim() : newDayPoint.trim() };
                                                                    });
                                                                    setNewDayPoint('');
                                                                }}
                                                                className="btn btn-primary"
                                                                style={{ position: 'absolute', bottom: '10px', right: '10px', width: 'auto', padding: '6px 16px', fontSize: '0.85rem' }}
                                                            >
                                                                <Plus size={14} /> Add Point
                                                            </button>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                            <AnimatePresence>
                                                {showCityNote[activeDay] && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        className="note-builder-container city-note"
                                                    >
                                                        <div className="note-label-premium"><MapPin size={14} /> Local City Knowledge</div>

                                                        {activeDayCities.length === 0 ? (
                                                            <div style={{ fontSize: '0.9rem', color: '#1e3a8a', padding: '20px', textAlign: 'center', background: 'rgba(255,255,255,0.5)', borderRadius: '12px' }}>
                                                                Add at least one city to Day {activeDay} to write city-specific tips.
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div style={{ marginBottom: '20px' }}>
                                                                    <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '800', color: '#1e3a8a', textTransform: 'uppercase', marginBottom: '8px' }}>Select Target City</label>
                                                                    <select
                                                                        className="premium-select"
                                                                        value={selectedCityIndex}
                                                                        onChange={(e) => {
                                                                            setSelectedCityForNote(prev => ({ ...prev, [activeDay]: Number(e.target.value) }));
                                                                            setEditingCityPointIdx(null);
                                                                            setNewCityPoint('');
                                                                        }}
                                                                        style={{ width: '100%', maxWidth: '300px' }}
                                                                    >
                                                                        {activeDayCities.map((cityItem, cityIdx) => {
                                                                            const master = allPlaces.find(p => p.id === (cityItem.id || cityItem.cityId));
                                                                            return (
                                                                                <option key={`${cityItem.id || cityItem.cityId}-${cityIdx}`} value={cityIdx}>
                                                                                    {master?.name || cityItem.name || `City ${cityIdx + 1}`}
                                                                                </option>
                                                                            );
                                                                        })}
                                                                    </select>
                                                                </div>

                                                                <div className="points-list-premium">
                                                                    {(selectedCityNoteText || '').split('\n').filter(p => p.trim()).map((point, pIdx) => (
                                                                        <div key={pIdx} className="point-card-premium">
                                                                            {editingCityPointIdx === pIdx ? (
                                                                                <div style={{ width: '100%' }}>
                                                                                    <textarea
                                                                                        value={editingCityPointValue}
                                                                                        onChange={(e) => setEditingCityPointValue(e.target.value)}
                                                                                        className="premium-textarea-input"
                                                                                        style={{ minHeight: '80px', marginBottom: '10px' }}
                                                                                    />
                                                                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                                                        <button onClick={() => {
                                                                                            const points = (selectedCityNoteText || '').split('\n');
                                                                                            points[pIdx] = editingCityPointValue.trim();
                                                                                            updateSelectedCityNote(points.join('\n'));
                                                                                            setEditingCityPointIdx(null);
                                                                                        }} className="btn btn-primary btn-sm" style={{ width: 'auto' }}>Save</button>
                                                                                        <button onClick={() => setEditingCityPointIdx(null)} className="btn btn-outline btn-sm" style={{ width: 'auto' }}>Cancel</button>
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <>
                                                                                    <div className="point-text"><span className="point-text-bullet">•</span>{point}</div>
                                                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                                                        <button onClick={() => { setEditingCityPointIdx(pIdx); setEditingCityPointValue(point); }} className="premium-action-btn"><Edit2 size={14} /></button>
                                                                                        <button onClick={() => {
                                                                                            const points = (selectedCityNoteText || '').split('\n');
                                                                                            points.splice(pIdx, 1);
                                                                                            updateSelectedCityNote(points.join('\n'));
                                                                                        }} className="premium-action-btn delete"><Trash2 size={14} /></button>
                                                                                    </div>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>

                                                                <div style={{ position: 'relative' }}>
                                                                    <textarea
                                                                        placeholder={`Add a specific tip for ${selectedCityMaster?.name || 'this city'}...`}
                                                                        value={newCityPoint}
                                                                        onChange={(e) => setNewCityPoint(e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                                                e.preventDefault();
                                                                                if (!newCityPoint.trim()) return;
                                                                                updateSelectedCityNote((current) => current ? `${current}\n${newCityPoint.trim()}` : newCityPoint.trim());
                                                                                setNewCityPoint('');
                                                                            }
                                                                        }}
                                                                        className="premium-textarea-input"
                                                                        style={{ minHeight: '100px' }}
                                                                    />
                                                                    <button
                                                                        onClick={() => {
                                                                            if (!newCityPoint.trim()) return;
                                                                            updateSelectedCityNote((current) => current ? `${current}\n${newCityPoint.trim()}` : newCityPoint.trim());
                                                                            setNewCityPoint('');
                                                                        }}
                                                                        className="btn btn-primary"
                                                                        style={{ position: 'absolute', bottom: '10px', right: '10px', width: 'auto', padding: '6px 16px', fontSize: '0.85rem' }}
                                                                    >
                                                                        <Plus size={14} /> Add Tip
                                                                    </button>
                                                                </div>
                                                            </>
                                                        )}
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            {(itinerary[activeDay] || []).map((item, idx) => {
                                                const place = allPlaces.find(p => p.id === (item.id || item.cityId));
                                                if (!place) return null;
                                                const placeSubPlaces = normalizeSubPlaces(
                                                    mergeSubPlacesByName(item.subPlaces, place.subPlaces)
                                                );

                                                return (
                                                    <motion.div
                                                        key={`${activeDay}-${idx}`}
                                                        layout
                                                        className="itinerary-item-editor"
                                                        style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '15px' }}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                                <div style={{ width: '40px', height: '40px', borderRadius: '8px', overflow: 'hidden' }}>
                                                                    <img src={place.image} alt={place.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                </div>
                                                                <h3 style={{ margin: 0 }}>{place.name}</h3>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <button
                                                                    onClick={(e) => openEditModal(e, place)}
                                                                    className="action-circle-btn"
                                                                    style={{ background: '#f1f5f9', color: '#64748b' }}
                                                                >
                                                                    <Edit2 size={16} />
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        setItinerary(prev => ({
                                                                            ...prev,
                                                                            [activeDay]: prev[activeDay].filter((_, i) => i !== idx)
                                                                        }));
                                                                    }}
                                                                    className="action-circle-btn"
                                                                    style={{ background: '#fee2e2', color: '#dc2626' }}
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '15px', lineHeight: '1.5' }}>
                                                            {(getEffectiveDescription(item) || '').substring(0, 150)}...
                                                        </p>

                                                        {(item.citySpecialNote || '').trim() && (
                                                            <div style={{ marginBottom: '15px', padding: '10px 12px', background: '#eef8ff', border: '1px solid #bfdbfe', borderRadius: '8px' }}>
                                                                <div style={{ fontSize: '0.76rem', fontWeight: 'bold', color: '#1e3a8a', marginBottom: '6px', textTransform: 'uppercase' }}>City Note</div>
                                                                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                                                                    {(item.citySpecialNote || '').split('\n').filter(v => v.trim()).map((line, noteIdx) => (
                                                                        <li key={noteIdx} style={{ fontSize: '0.83rem', color: '#1e293b', marginBottom: '4px' }}>{line.trim()}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}

                                                        {placeSubPlaces && placeSubPlaces.length > 0 && (
                                                            <div className="form-group" style={{ marginBottom: '15px' }}>
                                                                <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Select Special Places to Visit</label>
                                                                <select
                                                                    className="modern-input"
                                                                    onChange={(e) => {
                                                                        const selectedIdx = e.target.value;
                                                                        if (selectedIdx === "") return;

                                                                        const subToAdd = placeSubPlaces[selectedIdx];
                                                                        const currentSelection = hydrateSelectedSubPlaces(item.selectedSubPlaces, placeSubPlaces);

                                                                        const subNameToAdd = typeof subToAdd === 'string' ? subToAdd : subToAdd.name;
                                                                        const exists = currentSelection.some(s => (typeof s === 'string' ? s : s.name) === subNameToAdd);

                                                                        if (exists) return;

                                                                        setItinerary(prev => {
                                                                            const nextDay = [...prev[activeDay]];
                                                                            nextDay[idx] = { ...nextDay[idx], selectedSubPlaces: [...currentSelection, subToAdd] };
                                                                            return { ...prev, [activeDay]: nextDay };
                                                                        });
                                                                    }}
                                                                    value=""
                                                                >
                                                                    <option value="" disabled>--- Select a Place to Add ---</option>
                                                                    {placeSubPlaces.map((sub, sIdx) => (
                                                                        <option key={sIdx} value={sIdx}>{typeof sub === 'string' ? sub : sub.name}</option>
                                                                    ))}
                                                                </select>

                                                                {hydrateSelectedSubPlaces(item.selectedSubPlaces, placeSubPlaces).length > 0 && (
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                                                                        {hydrateSelectedSubPlaces(item.selectedSubPlaces, placeSubPlaces).map((sub, sIdx) => {
                                                                            const rawDisplayName = typeof sub === 'string' ? sub : sub.name;
                                                                            const displayName = rawDisplayName.charAt(0).toUpperCase() + rawDisplayName.slice(1).toLowerCase();
                                                                            const displayDesc = typeof sub === 'string' ? '' : sub.description;
                                                                            return (
                                                                                <div
                                                                                    key={sIdx}
                                                                                    style={{
                                                                                        background: 'white',
                                                                                        padding: '10px 15px',
                                                                                        borderRadius: '10px',
                                                                                        border: '1px solid #e2e8f0',
                                                                                        display: 'flex',
                                                                                        flexDirection: 'column',
                                                                                        gap: '5px',
                                                                                        width: '100%',
                                                                                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                                                                                    }}
                                                                                >
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                        <span style={{ fontWeight: 'bold', fontSize: '0.85rem', color: 'var(--primary)' }}>{displayName}</span>
                                                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                                                            <X
                                                                                                size={16}
                                                                                                style={{ cursor: 'pointer', color: '#dc2626' }}
                                                                                                onClick={() => {
                                                                                                    setItinerary(prev => {
                                                                                                        const nextDay = [...prev[activeDay]];
                                                                                                        nextDay[idx] = { ...nextDay[idx], selectedSubPlaces: item.selectedSubPlaces.filter((_, i) => i !== sIdx) };
                                                                                                        return { ...prev, [activeDay]: nextDay };
                                                                                                    });
                                                                                                }}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                    {displayDesc && (
                                                                                        <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic', borderTop: '1px solid #f1f5f9', paddingTop: '5px', marginTop: '2px' }}>
                                                                                            {displayDesc}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                    </motion.div>
                                                );
                                            })}

                                            <RouteMapPlanner
                                                plan={routeMapPlan}
                                                onPlanChange={handleRouteMapPlanChange}
                                            />

                                            <div className="destination-picker-dropdowns" style={{ marginTop: '40px', padding: '30px', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                                <h2 style={{ fontSize: '1.4rem', color: 'var(--primary)', marginBottom: '25px' }}>Add City to Day {activeDay}</h2>

                                                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
                                                    <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                                                        <label>Select City</label>
                                                        <select
                                                            className="modern-input"
                                                            onChange={(e) => {
                                                                const p = allPlaces.find(pl => pl.id === e.target.value);
                                                                if (p) {
                                                                    setItinerary(prev => ({
                                                                        ...prev,
                                                                        [activeDay]: [...(prev[activeDay] || []), { ...p, selectedSubPlaces: [], specialNote: '', citySpecialNote: '' }]
                                                                    }));
                                                                }
                                                            }}
                                                            value=""
                                                        >
                                                            <option value="" disabled>--- Choose a City ---</option>
                                                            {sortedCityOptions.map(p => (
                                                                <option key={p.id} value={p.id}>{p.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </section>

                    <aside className="sidebar">
                        <div style={{ position: 'sticky', top: '20px' }}>
                            <h2 style={{ marginBottom: '20px', color: 'var(--primary)' }}>Itinerary Status</h2>

                            <div className="status-card" style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <div style={{ marginBottom: '15px' }}>
                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Current Duration</div>
                                    <div style={{ fontWeight: 'bold' }}>
                                        {useTravelDates
                                            ? `${numDays} Days / ${Math.max(0, numDays - 1)} Nights`
                                            : `${Math.max(1, parseInt(manualDaysCount, 10) || 1)} Days / ${Math.max(0, parseInt(manualNightsCount, 10) || 0)} Nights`}
                                    </div>
                                </div>
                                <div style={{ marginBottom: '15px' }}>
                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Active Day</div>
                                    <div style={{ fontWeight: 'bold' }}>Day {activeDay}</div>
                                </div>
                                <div style={{ marginBottom: '0' }}>
                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Total Destinations</div>
                                    <div style={{ fontWeight: 'bold' }}>{totalSelected} Cities Selected</div>
                                </div>
                            </div>

                            <div style={{ marginTop: '30px' }}>
                                <button
                                    className="btn btn-primary"
                                    disabled={totalSelected === 0 || isPreparingPreview || isGenerating}
                                    onClick={openPreviewWithValidation}
                                    style={{ width: '100%', marginBottom: '10px' }}
                                >
                                    {isPreparingPreview ? <><div className="spinner"></div> Validating Preview...</> : <><Eye size={20} /> Preview & Download</>}
                                </button>

                                <button
                                    className="btn btn-outline"
                                    disabled={totalSelected === 0 || isGenerating}
                                    onClick={() => generatePDF()}
                                    style={{ width: '100%' }}
                                >
                                    {isGenerating ? (
                                        <>
                                            <div className="spinner"></div> Generating...
                                        </>
                                    ) : (
                                        <>
                                            <Download size={20} /> Direct Download
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* Removed redundant Quick Travel Info */}
                        </div>

                        {/* Redundant Trip Notes removed from Sidebar as they are now in Step 2 builder */}
                    </aside>
                </div>
            </main>

            {/* Always rendered but hidden for background generation if needed */}
            {/* Conditionally render hidden PDF content only when generating to save performance */}
            {
                (isGenerating || isPreparingPreview) && (
                    <div style={{ position: 'fixed', left: '-2000mm', top: 0, width: '210mm', backgroundColor: 'white', zIndex: -1000 }}>
                        <div id="hidden-pdf-content">
                            <ItineraryPDFContent
                                pages={pagesData}
                                arrivalDate={arrivalDate}
                                departureDate={departureDate}
                                useTravelDates={useTravelDates}
                                manualDaysCount={manualDaysCount}
                                manualNightsCount={manualNightsCount}
                                tripStart={tripStart}
                                tripEnd={tripEnd}
                                flightDetails={flightDetails}
                                customImages={customImages}
                                showDayNote={showDayNote}
                                dayNoteText={dayNoteText}
                                generationTime={generationTime}
                                includeRouteMapPage={shouldIncludeRouteMapPage}
                                routeMapPlan={routeMapPlanForPdf}
                            />
                        </div>
                    </div>
                )
            }
            {(isGeneratingCityPdf || showCityPreview) && cityPdfPlace && (
                <div style={{ position: 'fixed', left: '-2000mm', top: 0, width: '210mm', backgroundColor: 'white', zIndex: -1000 }}>
                    <div id={CITY_PDF_CONTAINER_ID}>
                        <CityPDFContent place={cityPdfPlace} />
                    </div>
                </div>
            )}

            <AnimatePresence>
                {systemPopup.open && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                        style={{ zIndex: 3000 }}
                    >
                        <motion.div
                            initial={{ y: 24, opacity: 0, scale: 0.98 }}
                            animate={{ y: 0, opacity: 1, scale: 1 }}
                            exit={{ y: 16, opacity: 0, scale: 0.98 }}
                            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                            style={{
                                width: 'min(92vw, 620px)',
                                borderRadius: '18px',
                                border: systemPopup.tone === 'warning' ? '1px solid #f59e0b' : '1px solid #f97316',
                                background: 'linear-gradient(145deg, #fff7ed 0%, #ffffff 60%)',
                                boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
                                overflow: 'hidden',
                            }}
                        >
                            <div style={{ padding: '20px 24px', borderBottom: '1px solid #fed7aa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '12px',
                                        background: systemPopup.tone === 'warning' ? '#fef3c7' : '#ffedd5',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: systemPopup.tone === 'warning' ? '#b45309' : '#c2410c',
                                    }}>
                                        <AlertTriangle size={20} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '1rem', fontWeight: 800, letterSpacing: '0.2px', color: '#7c2d12' }}>{systemPopup.title}</div>
                                        <div style={{ fontSize: '0.78rem', color: '#9a3412', textTransform: 'uppercase', letterSpacing: '0.7px', marginTop: '2px' }}>
                                            Premium System Notice
                                        </div>
                                    </div>
                                </div>
                                <button className="close-btn" onClick={closeSystemPopup} style={{ position: 'static', width: '34px', height: '34px' }}>
                                    <X size={18} />
                                </button>
                            </div>

                            <div style={{ padding: '22px 24px 16px', color: '#7c2d12' }}>
                                <p style={{ margin: 0, fontSize: '1rem', lineHeight: 1.5 }}>{systemPopup.message}</p>
                                {systemPopup.details && (
                                    <div style={{ marginTop: '12px', fontSize: '0.86rem', lineHeight: 1.45, color: '#9a3412', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '10px', padding: '10px 12px', wordBreak: 'break-word' }}>
                                        {systemPopup.details}
                                    </div>
                                )}
                            </div>

                            <div style={{ padding: '0 24px 22px', display: 'flex', justifyContent: 'flex-end' }}>
                                <button className="btn btn-primary" style={{ width: 'auto', padding: '10px 22px' }} onClick={closeSystemPopup}>
                                    Close
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showPreview && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                    >
                        <div className="modal-content">
                            <button className="close-btn" onClick={() => setShowPreview(false)}>
                                <X size={24} />
                            </button>

                            <div className="pdf-viewer-scroll">
                                <div ref={pdfRef}>
                                    <ItineraryPDFContent
                                        pages={pagesData}
                                        arrivalDate={arrivalDate}
                                        departureDate={departureDate}
                                        useTravelDates={useTravelDates}
                                        manualDaysCount={manualDaysCount}
                                        manualNightsCount={manualNightsCount}
                                        tripStart={tripStart}
                                        tripEnd={tripEnd}
                                        flightDetails={flightDetails}
                                        customImages={customImages}
                                        isPreview={true}
                                        showDayNote={showDayNote}
                                        dayNoteText={dayNoteText}
                                        generationTime={generationTime || new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                                        includeRouteMapPage={shouldIncludeRouteMapPage}
                                        routeMapPlan={routeMapPlanForPdf}
                                    />
                                </div>
                            </div>

                            <div style={{ padding: '20px', textAlign: 'center', background: '#f5f5f5', borderTop: '1px solid #ddd' }}>
                                <button
                                    className="btn btn-primary"
                                    style={{ width: '250px' }}
                                    onClick={() => generatePDF()}
                                    disabled={isGenerating}
                                >
                                    {isGenerating ? <div className="spinner"></div> : <><Download size={20} /> Download PDF</>}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showCityPreview && cityPdfPlace && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                    >
                        <div className="modal-content">
                            <button className="close-btn" onClick={closeCityPreview}>
                                <X size={24} />
                            </button>

                            <div className="pdf-viewer-scroll">
                                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    {Array.isArray(cityPdfPlace.allSubPlaces) && cityPdfPlace.allSubPlaces.length > 0 && (
                                        <div style={{ width: '100%', maxWidth: '794px', margin: '0 auto 16px', padding: '14px', background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 5, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px' }}>
                                                Select Highlights for This City PDF
                                            </div>
                                            <details>
                                                <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', fontSize: '0.85rem', color: '#334155', userSelect: 'none' }}>
                                                    <span>{cityPdfSelectedSubIndexes.length} selected</span>
                                                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Open</span>
                                                </summary>
                                                <div style={{ marginTop: '10px' }}>
                                                    <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                                                        <button type="button" className="btn btn-outline btn-sm" style={{ width: 'auto', padding: '8px 14px', marginTop: 0 }} onClick={selectAllCitySubPlaces}>Select All</button>
                                                        <button type="button" className="btn btn-outline btn-sm" style={{ width: 'auto', padding: '8px 14px', marginTop: 0 }} onClick={clearAllCitySubPlaces}>Clear All</button>
                                                    </div>
                                                    <div style={{ maxHeight: '190px', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                                                        {cityPdfPlace.allSubPlaces.map((sub, idx) => {
                                                            const subName = typeof sub === 'string' ? sub : (sub.name || `Place ${idx + 1}`);
                                                            return (
                                                                <label key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer', marginBottom: 0, textTransform: 'none', letterSpacing: 0, fontSize: '0.84rem' }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={cityPdfSelectedSubIndexes.includes(idx)}
                                                                        onChange={() => toggleCitySubPlace(idx)}
                                                                    />
                                                                    <span style={{ color: '#334155' }}>{subName}</span>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </details>
                                            <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '8px' }}>
                                                Only selected highlights will appear in the city PDF.
                                            </div>
                                        </div>
                                    )}
                                    <CityPDFContent place={cityPdfPlace} />
                                </div>
                            </div>

                            <div style={{ padding: '20px', textAlign: 'center', background: '#f5f5f5', borderTop: '1px solid #ddd' }}>
                                <button
                                    className="btn btn-primary"
                                    style={{ width: '250px' }}
                                    onClick={() => generateCityPDF(cityPdfPlace)}
                                    disabled={isGeneratingCityPdf}
                                >
                                    {isGeneratingCityPdf ? <div className="spinner"></div> : <><Download size={20} /> Download City PDF</>}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showPlaceForm && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                    >
                        <div className="modal-content" style={{ maxWidth: '900px', height: 'auto', maxHeight: '90vh', padding: '30px', overflowY: 'auto' }}>
                            <button className="close-btn" onClick={() => { setShowPlaceForm(false); setEditingPlaceId(null); }}>
                                <X size={24} />
                            </button>
                            <h2 style={{ color: 'var(--primary)', marginBottom: '25px', paddingBottom: '15px', borderBottom: '1px solid #eee' }}>
                                {editingPlaceId ? 'Edit Destination Details' : 'Add New Destination'}
                            </h2>

                            <div className="modal-form-grid">
                                <div className="form-left-col">
                                    <div className="form-group">
                                        <label>Place Name</label>
                                        <input
                                            type="text"
                                            value={newPlace.name}
                                            onChange={(e) => setNewPlace({ ...newPlace, name: e.target.value })}
                                            placeholder="e.g. Sigiriya"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Subtitle / Location</label>
                                        <input
                                            type="text"
                                            value={newPlace.title}
                                            onChange={(e) => setNewPlace({ ...newPlace, title: e.target.value })}
                                            placeholder="e.g. Ancient Rock Fortress"
                                        />
                                    </div>

                                    <div className="form-group image-upload-group">
                                        <label>Primary Image</label>
                                        <div className="image-input-wrapper">
                                            {newPlace.image && (
                                                <img src={newPlace.image} alt="Preview" className="input-preview-img" />
                                            )}
                                            <input type="file" accept="image/*" onChange={handleNewPlaceImage} disabled={!isAdmin} />
                                            {!isAdmin && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Admin only</div>}
                                        </div>
                                    </div>

                                    <div className="form-group image-upload-group">
                                        <label>Secondary Image (Optional)</label>
                                        <div className="image-input-wrapper">
                                            {newPlace.image2 && (
                                                <img src={newPlace.image2} alt="Preview" className="input-preview-img" />
                                            )}
                                            <input type="file" accept="image/*" onChange={handleNewPlaceImage2} disabled={!isAdmin} />
                                            {!isAdmin && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Admin only</div>}
                                        </div>
                                    </div>
                                </div>

                                <div className="form-right-col">
                                    <div className="form-group full-height">
                                        <div className="desc-manager">
                                            <div className="desc-card">
                                                <div className="desc-card-header">
                                                    <label className="desc-card-title">Description (Full details)</label>
                                                    <button
                                                        type="button"
                                                        className={`desc-lock-btn ${isDefaultDescriptionLocked ? 'locked' : ''}`}
                                                        onClick={() => setIsDefaultDescriptionLocked(prev => !prev)}
                                                    >
                                                        {isDefaultDescriptionLocked ? 'Locked' : 'Unlocked'}
                                                    </button>
                                                </div>
                                                <textarea
                                                    className={`desc-textarea ${isDefaultDescriptionLocked ? 'is-locked' : ''}`}
                                                    value={newPlace.description}
                                                    onChange={(e) => setNewPlace({ ...newPlace, description: e.target.value })}
                                                    placeholder="Enter the detailed description for the itinerary..."
                                                    readOnly={isDefaultDescriptionLocked}
                                                />
                                            </div>

                                            <div className="desc-card alt">
                                                <div className="desc-card-header">
                                                    <label className="desc-card-title">Alternative Description (Temporary)</label>
                                                    <span className="desc-tag">Session Only</span>
                                                </div>
                                                <textarea
                                                    className="desc-textarea alt"
                                                    value={newPlace.alternativeDescription || ''}
                                                    onChange={(e) => setNewPlace({ ...newPlace, alternativeDescription: e.target.value })}
                                                    placeholder="Temporary text for current session only. Clears after refresh."
                                                />
                                            </div>

                                            <div className="desc-source-switch" role="group" aria-label="Description source selector">
                                                <button
                                                    type="button"
                                                    className={`desc-source-btn ${(newPlace.activeDescriptionSource || 'default') === 'default' ? 'active' : ''}`}
                                                    onClick={() => setNewPlace({ ...newPlace, activeDescriptionSource: 'default' })}
                                                >
                                                    Use Full Details in PDF
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`desc-source-btn ${newPlace.activeDescriptionSource === 'alternative' ? 'active' : ''}`}
                                                    onClick={() => setNewPlace({ ...newPlace, activeDescriptionSource: 'alternative' })}
                                                >
                                                    Use Alternative in PDF
                                                </button>
                                            </div>

                                            <div className="desc-footnote">
                                                Alternative description is not saved to database and will be cleared after page refresh.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="form-group modal-full-row" style={{ padding: '0 10px 20px' }}>
                                    <label style={{ marginBottom: '15px', color: 'var(--primary)', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
                                        Structured Special Places to Visit
                                    </label>

                                    <div className="structured-subplaces-grid" style={{ marginBottom: '20px' }}>
                                        {(newPlace.subPlaces || []).map((sub, sIdx) => (
                                            <div
                                                key={sIdx}
                                                className={editingSubPlaceIdx === sIdx ? 'structured-subplace-card is-editing' : 'structured-subplace-card'}
                                            >
                                                {editingSubPlaceIdx === sIdx ? (
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2.3fr auto auto', gap: '10px', alignItems: 'center' }}>
                                                        <input
                                                            type="text"
                                                            value={editingSubValue.name}
                                                            onChange={(e) => setEditingSubValue({ ...editingSubValue, name: e.target.value })}
                                                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--primary)', fontSize: '0.85rem' }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    const updated = [...newPlace.subPlaces];
                                                                    updated[sIdx] = { ...editingSubValue };
                                                                    setNewPlace({ ...newPlace, subPlaces: updated });
                                                                    setEditingSubPlaceIdx(null);
                                                                }
                                                            }}
                                                        />
                                                        <input
                                                            type="text"
                                                            value={editingSubValue.description}
                                                            onChange={(e) => setEditingSubValue({ ...editingSubValue, description: e.target.value })}
                                                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--primary)', fontSize: '0.85rem' }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    const updated = [...newPlace.subPlaces];
                                                                    updated[sIdx] = { ...editingSubValue };
                                                                    setNewPlace({ ...newPlace, subPlaces: updated });
                                                                    setEditingSubPlaceIdx(null);
                                                                }
                                                            }}
                                                        />
                                                        <button
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                const updated = [...newPlace.subPlaces];
                                                                updated[sIdx] = { ...editingSubValue };
                                                                setNewPlace({ ...newPlace, subPlaces: updated });
                                                                setEditingSubPlaceIdx(null);
                                                            }}
                                                            style={{ background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 12px', fontSize: '0.75rem', cursor: 'pointer' }}
                                                        >Save</button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                setEditingSubPlaceIdx(null);
                                                            }}
                                                            style={{ border: '1px solid #ddd', background: 'white', color: '#666', borderRadius: '6px', padding: '8px 12px', fontSize: '0.75rem', cursor: 'pointer' }}
                                                        >Cancel</button>
                                                    </div>
                                                ) : (
                                                    <div className="structured-subplace-body">
                                                        <div style={{ flex: 1 }}>
                                                            <div className="structured-subplace-name">{sub.name}</div>
                                                            {sub.description && <div className="structured-subplace-description">{sub.description}</div>}
                                                        </div>
                                                        <div className="structured-subplace-actions">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    setEditingSubPlaceIdx(sIdx);
                                                                    setEditingSubValue({ ...sub });
                                                                }}
                                                                className="structured-subplace-btn edit"
                                                            >
                                                                <Edit2 size={14} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    const updatedSubs = [...newPlace.subPlaces];
                                                                    updatedSubs.splice(sIdx, 1);
                                                                    setNewPlace({ ...newPlace, subPlaces: updatedSubs });
                                                                }}
                                                                className="structured-subplace-btn delete"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {(!newPlace.subPlaces || newPlace.subPlaces.length === 0) && (
                                            <div className="structured-subplace-empty" style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '0.85rem', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1' }}>
                                                No special places added yet. Add one below.
                                            </div>
                                        )}
                                    </div>

                                    <div className="add-new-place-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569' }}>Add New Place Detail</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr auto', gap: '12px', alignItems: 'flex-end' }}>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '4px' }}>PLACE NAME</div>
                                                <input
                                                    type="text"
                                                    placeholder="e.g. Temple of Tooth"
                                                    value={newSubPlace.name}
                                                    onChange={(e) => setNewSubPlace({ ...newSubPlace, name: e.target.value })}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            if (!newSubPlace.name.trim()) return;
                                                            setNewPlace({
                                                                ...newPlace,
                                                                subPlaces: [...(newPlace.subPlaces || []), { ...newSubPlace }]
                                                            });
                                                            setNewSubPlace({ name: '', description: '' });
                                                        }
                                                    }}
                                                    className="modern-input"
                                                    style={{ padding: '10px 12px', fontSize: '0.85rem' }}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '4px' }}>SIMPLE DESCRIPTION</div>
                                                <input
                                                    type="text"
                                                    placeholder="Short caption (optional)..."
                                                    value={newSubPlace.description}
                                                    onChange={(e) => setNewSubPlace({ ...newSubPlace, description: e.target.value })}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            if (!newSubPlace.name.trim()) return;
                                                            setNewPlace({
                                                                ...newPlace,
                                                                subPlaces: [...(newPlace.subPlaces || []), { ...newSubPlace }]
                                                            });
                                                            setNewSubPlace({ name: '', description: '' });
                                                        }
                                                    }}
                                                    className="modern-input"
                                                    style={{ padding: '10px 12px', fontSize: '0.85rem' }}
                                                />
                                            </div>
                                            <button
                                                onClick={() => {
                                                    if (!newSubPlace.name.trim()) return;
                                                    setNewPlace({
                                                        ...newPlace,
                                                        subPlaces: [...(newPlace.subPlaces || []), { ...newSubPlace }]
                                                    });
                                                    setNewSubPlace({ name: '', description: '' });
                                                }}
                                                className="btn btn-primary"
                                                style={{ padding: '12px 20px', fontSize: '0.85rem' }}
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="gallery-section" style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
                                <h3 style={{ fontSize: '1.1rem', marginBottom: '15px', color: 'var(--text-dark)' }}>Image Gallery</h3>

                                <div className="gallery-grid">
                                    {currentGallery.map((img, idx) => (
                                        <div key={idx} className="gallery-item">
                                            <img
                                                src={img}
                                                alt={`Gallery ${idx}`}
                                                className="gallery-thumb"
                                                loading="lazy"
                                            />
                                            <div className="gallery-overlays">
                                                <button className={`gallery-btn primary ${newPlace.image === img ? 'active' : ''}`} onClick={() => setFromGallery(img, 'primary')} title="Set as Primary" disabled={!isAdmin}>1</button>
                                                <button className={`gallery-btn secondary ${newPlace.image2 === img ? 'active' : ''}`} onClick={() => setFromGallery(img, 'secondary')} title="Set as Secondary" disabled={!isAdmin}>2</button>
                                                {isAdmin && !(galleryDataRaw[editingPlaceId] || []).includes(img) && (
                                                    <button className="gallery-btn delete" onClick={() => handleGalleryDelete(img)} title="Remove"><Trash2 size={12} /></button>
                                                )}
                                            </div>
                                            {newPlace.image === img && <div className="gallery-badge primary">1</div>}
                                            {newPlace.image2 === img && <div className="gallery-badge secondary">2</div>}
                                        </div>
                                    ))}
                                    {currentGallery.length === 0 && <p style={{ gridColumn: '1/-1', color: '#999', fontSize: '0.9rem' }}>No images in gallery. Upload below.</p>}
                                </div>

                                <label
                                    className="btn btn-outline btn-sm"
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        cursor: isAdmin ? 'pointer' : 'not-allowed',
                                        marginTop: '10px',
                                        opacity: isAdmin ? 1 : 0.55
                                    }}
                                >
                                    <Plus size={16} /> Add Photos to Gallery
                                    <input type="file" multiple accept="image/*" onChange={handleGalleryUpload} style={{ display: 'none' }} disabled={!isAdmin} />
                                </label>
                                {!isAdmin && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '8px' }}>Gallery add/remove is admin only.</div>}
                            </div>

                            <div className="modal-actions">
                                <button className="btn btn-primary" onClick={handleAddPlace}>
                                    {editingPlaceId
                                        ? (newPlace.activeDescriptionSource === 'alternative' ? 'Update Destination + Alt Description' : 'Update Destination')
                                        : (newPlace.activeDescriptionSource === 'alternative' ? 'Add Destination + Alt Description' : 'Add Destination')}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            <Analytics />
        </div >
    );
}

export default App;


