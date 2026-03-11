import React, { useState, useRef } from 'react';
import { places } from './data';
import { Download, Eye, X, Check, MapPin, Calendar, User, Globe, Image as ImageIcon, Edit2, Trash2, Plus, Phone, Plane, Camera, Palmtree, Compass, Cloud } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { motion, AnimatePresence } from 'framer-motion';
import { Analytics } from "@vercel/analytics/react";

import galleryDataRaw from './gallery_data.json';
import { supabase } from './supabase';
import { CITY_PDF_CONTAINER_ID, CityPDFContent, downloadCityPdfFromContainer } from './cityPdf';
import RouteMapPlanner, { RouteMapPdfPage, hasRenderableRouteMapPlan } from './components/RouteMapPlanner';

const ROUTE_MAP_SNAPSHOT_KEY = 'route_map_saved_snapshot_v1';
const LOGIN_ROLE_KEY = 'itinerary_login_role_v1';
const LOCAL_LOGIN_CREDENTIALS = {
    admin: 'admin',
    user: 'user',
};

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
    const [cityPdfPlace, setCityPdfPlace] = useState(null);
    const [cityPdfSelectedSubIndexes, setCityPdfSelectedSubIndexes] = useState([]);
    const [userPlaces, setUserPlaces] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [showDayNote, setShowDayNote] = useState({}); // { 1: true, 2: false }
    const [dayNoteText, setDayNoteText] = useState({}); // { 1: "Note for day 1" }
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

                    destData.forEach(dbPlace => {
                        const formattedPlace = {
                            ...dbPlace,
                            subPlaces: dbPlace.sub_places || [],
                        };

                        dbPlacesMap[dbPlace.id] = formattedPlace;

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
                                subPlaces: dbP.subPlaces && dbP.subPlaces.length > 0 ? dbP.subPlaces : pl.subPlaces,
                                image: dbP.image_url || pl.image,
                                image2: dbP.image_url_2 || pl.image2,
                            };
                        }
                        return pl;
                    }));

                    if (newCustomPlaces.length > 0) {
                        setUserPlaces(newCustomPlaces);
                    }
                }


            } catch (err) {
                console.error("Error fetching initial data", err);

            }
        };

        fetchAllData();

        return () => clearTimeout(timer);
    }, []);


    const [placesList, setPlacesList] = useState(() => {
        return places.map(p => {
            const galleryImages = galleryDataRaw[p.id] || [];
            if (galleryImages.length > 0) {
                return {
                    ...p,
                    image: galleryImages[0],
                    image2: galleryImages.length > 1 ? galleryImages[1] : null
                };
            }
            return p;
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
    const [editingSubPlaceIdx, setEditingSubPlaceIdx] = useState(null);
    const [editingSubValue, setEditingSubValue] = useState({ name: '', description: '' });
    const [editingDayPointIdx, setEditingDayPointIdx] = useState(null);
    const [editingDayPointValue, setEditingDayPointValue] = useState('');
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

    const canStartBuilding =
        (useTravelDates
            ? (Boolean(arrivalDate) && Boolean(departureDate))
            : (manualDaysValid && manualNightsValid)) &&
        Boolean(tripStart.trim()) &&
        Boolean(tripEnd.trim());

    const togglePlace = (place) => {
        setItinerary(prev => {
            const currentDayPlaces = prev[activeDay] || [];
            const alreadySelected = currentDayPlaces.find(p => p.id === place.id);

            return {
                ...prev,
                [activeDay]: alreadySelected
                    ? currentDayPlaces.filter(p => p.id !== place.id)
                    : [...currentDayPlaces, { ...place, selectedSubPlaces: [] }]
            };
        });
    };



    const handleAddPlace = async () => {
        if (!newPlace.name || !newPlace.description || !newPlace.image) {
            alert("Please provide place name, description and image.");
            return;
        }

        if (editingPlaceId) {
            // Edit existing

            // Sync to Supabase in the background
            try {
                await supabase.from('destinations').upsert({
                    id: editingPlaceId,
                    name: newPlace.name,
                    title: newPlace.title,
                    description: newPlace.description,
                    image_url: newPlace.image,
                    image_url_2: newPlace.image2,
                    sub_places: newPlace.subPlaces
                });
            } catch (e) {
                console.error("Failed to update Supabase", e);
            }

            const updateFn = (list) => list.map(p => p.id === editingPlaceId ? { ...newPlace, id: editingPlaceId } : p);

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
                                const match = (newPlace.subPlaces || []).find(sp => (typeof sp === 'string' ? sp : sp.name) === currentName);
                                return match || currentSelected;
                            });
                            return { ...newPlace, id: editingPlaceId, selectedSubPlaces: updatedSelected };
                        }
                        return p;
                    });
                });
                return next;
            });
        } else {
            // Add new
            const id = `custom-${Date.now()}`;
            const p = { ...newPlace, id };

            try {
                await supabase.from('destinations').insert({
                    id: id,
                    name: newPlace.name,
                    title: newPlace.title || '',
                    description: newPlace.description,
                    image_url: newPlace.image,
                    image_url_2: newPlace.image2,
                    sub_places: newPlace.subPlaces
                });
            } catch (e) {
                console.error("Failed to insert into Supabase", e);
            }

            setUserPlaces(prev => [...prev, p]);
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
        // Convert any string-only subPlaces to objects for the new structured UI
        const structuredSubPlaces = (place.subPlaces || []).map(sp =>
            typeof sp === 'string' ? { name: sp, description: '' } : sp
        );

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
            alert("Only admin can change images.");
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
            alert("Only admin can change images.");
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
            alert("Only admin can add images.");
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
            alert("Only admin can remove images.");
            return;
        }
        // Prevent deleting default images
        const defaultImages = galleryDataRaw[editingPlaceId] || [];
        if (defaultImages.includes(imageToDelete)) {
            alert("This is a default image and cannot be deleted.");
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
            alert("Only admin can change selected images.");
            return;
        }
        if (type === 'primary') {
            setNewPlace(prev => ({ ...prev, image: imgUrl }));
        } else {
            setNewPlace(prev => ({ ...prev, image2: imgUrl }));
        }
    };

    const currentGallery = editingPlaceId ? (placesGallery[editingPlaceId] || []) : [];

    const allPlaces = [...placesList, ...userPlaces];
    const getEffectiveDescription = (placeItem) => {
        const altText = (placeItem?.alternativeDescription || '').trim();
        if (placeItem?.activeDescriptionSource === 'alternative' && altText) {
            return altText;
        }
        return placeItem?.description || '';
    };
    const paginatePlaces = () => {
        const flowItems = [];
        for (let d = 1; d <= numDays; d++) {
            const dayPlaces = itinerary[d] || [];
            dayPlaces.forEach(item => {
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

                if (item.selectedSubPlaces && item.selectedSubPlaces.length > 0) {
                    item.selectedSubPlaces.forEach((sub, subIdx) => {
                        flowItems.push({
                            type: 'dest-highlight-point',
                            highlight: sub,
                            isFirst: subIdx === 0,
                            isLast: subIdx === item.selectedSubPlaces.length - 1,
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

        const BOTTOM_SIGNAL_MM = 2;
        const PAGE_HEIGHT_MM = 297;

        const getItemWeight = (item) => {
            let weight = 0;
            if (item.type === 'dayNote') {
                const linesRaw = (item.text || '').split('\n').filter(l => l.trim());
                weight = 0.42 + (linesRaw.length * 0.16);
            } else if (item.type === 'dest-head') {
                weight = 1.2;
                if (item.image2) weight += 0.25;
            } else if (item.type === 'dest-para') {
                weight = Math.max(0.07, (item.text || '').length / 980);
            } else if (item.type === 'dest-highlight-point') {
                const sub = item.highlight;
                const subName = typeof sub === 'string' ? sub : (sub?.name || '');
                const subDesc = typeof sub === 'string' ? '' : (sub?.description || '');
                const pointLen = (subName + ' ' + subDesc).trim().length;
                weight = Math.max(0.16, 0.08 + (pointLen / 760));
            }
            return weight;
        };

        const packItems = (items, firstCap, otherCap) => {
            const packed = [];
            let current = [];
            let currentWeight = 0;

            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                const weight = getItemWeight(item);
                const isFirstPackedPage = packed.length === 0;
                const maxWeight = isFirstPackedPage ? firstCap : otherCap;

                // Keep destination head (title + images) with at least one following content block.
                // This prevents "images on one page, text on next page" for any city.
                if (item.type === 'dest-head') {
                    const nextItem = items[index + 1];
                    const sameDestNext =
                        nextItem &&
                        nextItem.destId === item.destId &&
                        (nextItem.type === 'dest-para' || nextItem.type === 'dest-highlight-point');

                    if (sameDestNext) {
                        const pairWeight = weight + getItemWeight(nextItem);
                        if (currentWeight + pairWeight > maxWeight && current.length > 0) {
                            packed.push([...current]);
                            current = [];
                            currentWeight = 0;
                        }
                    }
                }

                if (currentWeight + weight > maxWeight && current.length > 0) {
                    packed.push([...current]);
                    current = [];
                    currentWeight = 0;
                }

                current.push(item);
                currentWeight += weight;

                if (index === items.length - 1 && current.length > 0) {
                    packed.push([...current]);
                }
            }

            if (packed.length === 0) packed.push([]);
            return packed;
        };

        // Header only on first page, footer only on last page.
        const firstPageCapacity = 3.4 * ((PAGE_HEIGHT_MM - BOTTOM_SIGNAL_MM) / PAGE_HEIGHT_MM); // header + welcome
        const middlePageCapacity = 5.95 * ((PAGE_HEIGHT_MM - BOTTOM_SIGNAL_MM) / PAGE_HEIGHT_MM); // no header/footer
        const lastPageCapacity = 4.75 * ((PAGE_HEIGHT_MM - BOTTOM_SIGNAL_MM) / PAGE_HEIGHT_MM); // footer only (safe but fuller)
        const singlePageCapacity = 3.15 * ((PAGE_HEIGHT_MM - BOTTOM_SIGNAL_MM) / PAGE_HEIGHT_MM); // header + footer

        let pages = packItems(flowItems, firstPageCapacity, middlePageCapacity);

        const getPageWeight = (items) => items.reduce((sum, it) => sum + getItemWeight(it), 0);
        while (pages.length > 0) {
            const lastIdx = pages.length - 1;
            const lastPage = pages[lastIdx];
            const cap = pages.length === 1 ? singlePageCapacity : lastPageCapacity;
            let lastWeight = getPageWeight(lastPage);

            if (lastWeight <= cap) break;

            const overflowItems = [];
            while (lastPage.length > 0 && lastWeight > cap) {
                overflowItems.unshift(lastPage.pop());
                lastWeight = getPageWeight(lastPage);
            }

            // Safety: never leave a destination head orphaned at page end.
            // If the page ends with `dest-head` and no following item from same destination,
            // move that head to next page along with overflow.
            if (lastPage.length > 0) {
                const tail = lastPage[lastPage.length - 1];
                if (tail.type === 'dest-head') {
                    overflowItems.unshift(lastPage.pop());
                    lastWeight = getPageWeight(lastPage);
                }
            }

            if (lastPage.length === 0) {
                pages.pop();
            }

            const overflowPages = packItems(overflowItems, middlePageCapacity, middlePageCapacity);
            pages = [...pages, ...overflowPages];
        }

        if (pages.length === 0) pages.push([]);
        return pages;
    };

    const pagesData = paginatePlaces();
    const [isPdfReady, setIsPdfReady] = useState(false);

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
                const latestRouteMapPlan = routeMapPlanRef.current || routeMapPlan;
                const container = document.getElementById('hidden-pdf-content');
                if (!container) {
                    console.error("PDF container not found");
                    setIsGenerating(false);
                    return;
                }
                const pageElements = container.querySelectorAll('.pdf-page');

                if (pageElements.length === 0) {
                    alert("Please add some places to the itinerary first.");
                    setIsGenerating(false);
                    return;
                }

                const pdf = new jsPDF('p', 'mm', 'a4');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = pdf.internal.pageSize.getHeight();

                for (let i = 0; i < pageElements.length; i++) {
                    if (i > 0) pdf.addPage();

                    const canvas = await html2canvas(pageElements[i], {
                        scale: 1.5, // Reduced scale for better performance and stability
                        useCORS: true,
                        logging: false,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                    });

                    const imgData = canvas.toDataURL('image/jpeg', 0.8);
                    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
                }

                const canAttachRoutePlan = safeForceAttach
                    || latestRouteMapPlan?.attachToFinalPdf === true
                    || routeMapPlan?.attachToFinalPdf === true;
                if (canAttachRoutePlan) {
                    const hiddenHasRouteMapPage = container.querySelectorAll('.route-map-pdf-page').length > 0;
                    if (hiddenHasRouteMapPage) {
                        const dateStr = new Date().toISOString().slice(0, 10);
                        pdf.save(`Invel-Sri-Lanka-Itinerary-${dateStr}.pdf`);
                        return;
                    }

                    let persistedSnapshot = '';
                    try {
                        persistedSnapshot = localStorage.getItem(ROUTE_MAP_SNAPSHOT_KEY) || '';
                    } catch (_err) {
                        persistedSnapshot = '';
                    }
                    const routeMapSnapshot = safeForcedSnapshot || persistedSnapshot || latestRouteMapPlan?.mapSnapshot || '';

                    if (routeMapSnapshot) {
                        if (routeMapSnapshot !== latestRouteMapPlan?.mapSnapshot) {
                            setRouteMapPlan((prev) => ({
                                ...(prev || {}),
                                mapSnapshot: routeMapSnapshot,
                            }));
                        }

                        pdf.addPage();
                        const pdfHeight = pdf.internal.pageSize.getHeight();
                        const marginX = 8;
                        const marginY = 8;
                        const mapImgType = routeMapSnapshot.startsWith('data:image/png') ? 'PNG' : 'JPEG';
                        const imageSize = await new Promise((resolve, reject) => {
                            const img = new Image();
                            img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
                            img.onerror = () => reject(new Error('Route map image load failed'));
                            img.src = routeMapSnapshot;
                        });
                        const maxWidth = pdfWidth - marginX * 2;
                        const maxHeight = pdfHeight - marginY * 2;
                        const ratio = Math.min(maxWidth / imageSize.width, maxHeight / imageSize.height);
                        const drawWidth = imageSize.width * ratio;
                        const drawHeight = imageSize.height * ratio;
                        const drawX = (pdfWidth - drawWidth) / 2;
                        const drawY = (pdfHeight - drawHeight) / 2;
                        pdf.addImage(routeMapSnapshot, mapImgType, drawX, drawY, drawWidth, drawHeight);
                    }
                }

                const dateStr = new Date().toISOString().slice(0, 10);
                pdf.save(`Invel-Sri-Lanka-Itinerary-${dateStr}.pdf`);
            } catch (error) {
                console.error(error);
                alert("Error generating PDF. Please try again.");
            } finally {
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
                alert("Error generating city PDF. Please try again.");
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
                                            disabled={!canStartBuilding}
                                            onClick={() => {
                                                if (!canStartBuilding) return;
                                                setCurrentStep(3);
                                            }}
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
                                        <button className="btn btn-outline" onClick={() => setCurrentStep(1)}>Back to Menu</button>
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
                                                                <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '5px' }}>{p.subPlaces.slice(0, 3).join(', ')}{p.subPlaces.length > 3 ? '...' : ''}</p>
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
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', flexWrap: 'wrap', gap: '15px' }}>
                                        <div>
                                            <button
                                                onClick={() => setCurrentStep(1)}
                                                style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px', padding: 0 }}
                                            >
                                                Back to Menu
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
                                        <div className="active-day-itinerary">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                                <h2 style={{ fontSize: '1.2rem', color: 'var(--primary)', margin: 0 }}>Day {activeDay} Destinations</h2>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer', background: '#f8fafc', padding: '8px 15px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={showDayNote[activeDay] || false}
                                                        onChange={(e) => {
                                                            const checked = e.target.checked;
                                                            setShowDayNote(prev => ({ ...prev, [activeDay]: checked }));
                                                            if (!checked) setDayNoteText(prev => ({ ...prev, [activeDay]: '' }));
                                                        }}
                                                    />
                                                    Add Special Note for Day {activeDay}?
                                                </label>
                                            </div>

                                            {showDayNote[activeDay] && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    style={{ marginBottom: '25px', padding: '20px', background: '#fff9e6', borderRadius: '12px', border: '1px solid #ffeeba' }}
                                                >
                                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '12px', color: '#856404' }}>General Itinerary Note for Day {activeDay} (Point by Point)</label>

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                                                        {(dayNoteText[activeDay] || '').split('\n').filter(p => p.trim()).map((point, pIdx) => (
                                                            <div key={pIdx} style={{ background: 'white', padding: '12px 15px', borderRadius: '8px', border: '1px solid #ffeeba', boxShadow: '0 2px 4px rgba(133, 100, 4, 0.05)' }}>
                                                                {editingDayPointIdx === pIdx ? (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                                                                        <textarea
                                                                            value={editingDayPointValue}
                                                                            onChange={(e) => setEditingDayPointValue(e.target.value)}
                                                                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--primary)', fontSize: '0.95rem', minHeight: '100px', background: 'white' }}
                                                                        />
                                                                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                                                            <button
                                                                                onClick={() => {
                                                                                    const points = (dayNoteText[activeDay] || '').split('\n');
                                                                                    points[pIdx] = editingDayPointValue.trim();
                                                                                    setDayNoteText(prev => ({ ...prev, [activeDay]: points.join('\n') }));
                                                                                    setEditingDayPointIdx(null);
                                                                                }}
                                                                                className="btn btn-primary"
                                                                                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                                                                            >Save Changes</button>
                                                                            <button
                                                                                onClick={() => setEditingDayPointIdx(null)}
                                                                                className="btn btn-outline"
                                                                                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                                                                            >Cancel</button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                        <span style={{ fontSize: '0.9rem', color: '#1a202c', flex: 1 }}>• {point}</span>
                                                                        <div style={{ display: 'flex', gap: '5px' }}>
                                                                            <button
                                                                                onClick={() => {
                                                                                    setEditingDayPointIdx(pIdx);
                                                                                    setEditingDayPointValue(point);
                                                                                }}
                                                                                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: '6px', padding: '6px', cursor: 'pointer' }}
                                                                            >
                                                                                <Edit2 size={14} />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => {
                                                                                    const points = (dayNoteText[activeDay] || '').split('\n');
                                                                                    points.splice(pIdx, 1);
                                                                                    setDayNoteText(prev => ({ ...prev, [activeDay]: points.join('\n') }));
                                                                                }}
                                                                                style={{ background: '#fff5f5', border: '1px solid #fed7d7', color: '#e53e3e', borderRadius: '6px', padding: '6px', cursor: 'pointer' }}
                                                                            >
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <div style={{ borderTop: '2px dashed #ffeeba', paddingTop: '20px' }}>
                                                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '10px' }}>ADD NEW HIGHLIGHT POINT</div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                            <textarea
                                                                placeholder="Type a new highlight or special note point here... (Press Enter to add)"
                                                                value={newDayPoint}
                                                                onChange={(e) => setNewDayPoint(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                                        e.preventDefault();
                                                                        if (!newDayPoint.trim()) return;
                                                                        setDayNoteText(prev => {
                                                                            const current = prev[activeDay] || '';
                                                                            const updated = current ? current + '\n' + newDayPoint.trim() : newDayPoint.trim();
                                                                            return { ...prev, [activeDay]: updated };
                                                                        });
                                                                        setNewDayPoint('');
                                                                    }
                                                                }}
                                                                style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '2px solid #ffeeba', fontSize: '1.05rem', minHeight: '180px', background: 'white', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.03)', lineHeight: '1.6', resize: 'vertical' }}
                                                            />
                                                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                                <button
                                                                    onClick={() => {
                                                                        if (!newDayPoint.trim()) return;
                                                                        setDayNoteText(prev => {
                                                                            const current = prev[activeDay] || '';
                                                                            const updated = current ? current + '\n' + newDayPoint.trim() : newDayPoint.trim();
                                                                            return { ...prev, [activeDay]: updated };
                                                                        });
                                                                        setNewDayPoint('');
                                                                    }}
                                                                    className="btn btn-primary"
                                                                    style={{ padding: '10px 24px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '8px' }}
                                                                >
                                                                    <Plus size={18} /> Add Point to Journey
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}

                                            {(itinerary[activeDay] || []).map((item, idx) => {
                                                const place = allPlaces.find(p => p.id === (item.id || item.cityId));
                                                if (!place) return null;

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

                                                        {place.subPlaces && place.subPlaces.length > 0 && (
                                                            <div className="form-group" style={{ marginBottom: '15px' }}>
                                                                <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Select Special Places to Visit</label>
                                                                <select
                                                                    className="modern-input"
                                                                    onChange={(e) => {
                                                                        const selectedIdx = e.target.value;
                                                                        if (selectedIdx === "") return;

                                                                        const subToAdd = place.subPlaces[selectedIdx];
                                                                        const currentSelection = item.selectedSubPlaces || [];

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
                                                                    {place.subPlaces.map((sub, sIdx) => (
                                                                        <option key={sIdx} value={sIdx}>{typeof sub === 'string' ? sub : sub.name}</option>
                                                                    ))}
                                                                </select>

                                                                {item.selectedSubPlaces && item.selectedSubPlaces.length > 0 && (
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                                                                        {item.selectedSubPlaces.map((sub, sIdx) => {
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
                                                                        [activeDay]: [...(prev[activeDay] || []), { ...p, selectedSubPlaces: [], specialNote: '' }]
                                                                    }));
                                                                }
                                                            }}
                                                            value=""
                                                        >
                                                            <option value="" disabled>--- Choose a City ---</option>
                                                            {allPlaces.map(p => (
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
                                    disabled={totalSelected === 0}
                                    onClick={() => setShowPreview(true)}
                                    style={{ width: '100%', marginBottom: '10px' }}
                                >
                                    <Eye size={20} /> Preview & Download
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
                isGenerating && (
                    <div style={{ position: 'fixed', left: '-2000mm', top: 0, width: '210mm', backgroundColor: 'white', zIndex: -1000 }}>
                        <div id="hidden-pdf-content">
                            <PDFContent
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
                                    <PDFContent
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

const PDFPage = ({ children, pageNumber, totalPages, generationTime }) => (
    <div className="pdf-page">
        <div className="pdf-page-border"></div>
        {generationTime && (
            <div style={{
                position: 'absolute',
                right: '25px',
                top: '6px',
                fontSize: '0.65rem',
                opacity: 0.8,
                fontStyle: 'italic',
                color: 'var(--text-light)',
                whiteSpace: 'nowrap',
                zIndex: 100
            }}>
                Generated: {generationTime}
            </div>
        )}
        <div className="pdf-page-content">
            <div className="pdf-page-inner">
                {children}
            </div>
        </div>
    </div>
);

const PDFContent = ({
    pages,
    arrivalDate,
    departureDate,
    useTravelDates = true,
    manualDaysCount = 1,
    manualNightsCount = 0,
    tripStart,
    tripEnd,
    flightDetails = '',
    customImages,
    isPreview,
    generationTime,
    showDayNote = {},
    dayNoteText = {},
    includeRouteMapPage = false,
    routeMapPlan = null,
}) => {
    const calculateTourHeading = () => {
        let days = 0;
        let nights = 0;

        if (useTravelDates && arrivalDate && departureDate) {
            const start = new Date(arrivalDate);
            const end = new Date(departureDate);
            days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            nights = Math.max(0, days - 1);
        } else {
            days = Math.max(1, parseInt(manualDaysCount, 10) || 1);
            nights = Math.max(0, parseInt(manualNightsCount, 10) || 0);
        }

        return `${String(nights).padStart(2, '0')} NIGHTS ${String(days).padStart(2, '0')} DAYS TOUR ITINERARY TO SRI LANKA`;
    };

    const renderedDayLabels = new Set();

    return (
        <div className="pdf-preview-container">
            {pages.map((items, pageIndex) => (
                <div key={pageIndex}>
                    <PDFPage
                        pageNumber={pageIndex + 1}
                        totalPages={pages.length}
                        generationTime={pageIndex === 0 ? generationTime : null}
                    >
                        {pageIndex === 0 && (
                            <div className="pdf-fixed-header">
                                <div className="pdf-header-premium">
                                <div className="pdf-logo-wrapper">
                                    <img src="/logo.png" alt="Logo" className="pdf-logo-main" />
                                </div>
                                <div className="pdf-header-divider"></div>
                                <div className="pdf-header-info">
                                    <div style={{
                                        marginTop: '5px',
                                        padding: '10px 0',
                                        borderTop: '2px solid var(--primary)',
                                        borderBottom: '2px solid var(--primary)',
                                        textAlign: 'center',
                                        fontWeight: 'bold',
                                        fontSize: '1.2rem',
                                        color: '#1a365d'
                                    }}>
                                        {calculateTourHeading()}
                                    </div>

                                    <div className="pdf-header-details-grid" style={{ marginTop: '15px' }}>
                                        <div className="pdf-header-col">
                                            {useTravelDates ? (
                                                <>
                                                    <div className="pdf-date-badge">
                                                        <span className="label">ARRIVAL DATE</span>
                                                        <span className="value">{arrivalDate ? new Date(arrivalDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBD'}</span>
                                                    </div>
                                                    <div className="pdf-date-badge">
                                                        <span className="label">DEPARTURE DATE</span>
                                                        <span className="value">{departureDate ? new Date(departureDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBD'}</span>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="pdf-date-badge">
                                                        <span className="label">DAYS COUNT</span>
                                                        <span className="value">{Math.max(1, parseInt(manualDaysCount, 10) || 1)}</span>
                                                    </div>
                                                    <div className="pdf-date-badge">
                                                        <span className="label">NIGHTS COUNT</span>
                                                        <span className="value">{Math.max(0, parseInt(manualNightsCount, 10) || 0)}</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        <div className="pdf-header-col">
                                            <div className="pdf-date-badge">
                                                <span className="label">START POINT</span>
                                                <span className="value">{tripStart || 'Colombo / Airport'}</span>
                                            </div>
                                            <div className="pdf-date-badge">
                                                <span className="label">END POINT</span>
                                                <span className="value">{tripEnd || 'Colombo / Airport'}</span>
                                            </div>
                                            {flightDetails?.trim() && (
                                                <div className="pdf-date-badge">
                                                    <span className="label">FLIGHT DETAILS</span>
                                                    <span className="value">{flightDetails}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            </div>
                        )}

                        <div className="pdf-fixed-content">
                            {pageIndex === 0 && (
                                <div className="pdf-welcome-section">
                                    <div className="welcome-tag">Ayubowan!</div>
                                    <p>
                                        Welcome to the Paradise Island of Sri Lanka. We have curated this itinerary to ensure you experience
                                        the very best of our breathtaking landscapes and cultural heritage.
                                    </p>
                                </div>
                            )}

                            <div className="pdf-itinerary-list">
                            {(() => {
                                const grouped = [];
                                let currentGroup = null;

                                items.forEach(item => {
                                    if (item.type === 'dayNote') {
                                        if (currentGroup) {
                                            grouped.push(currentGroup);
                                            currentGroup = null;
                                        }
                                        grouped.push(item);
                                    } else {
                                        if (currentGroup && currentGroup.destId === item.destId) {
                                            currentGroup.parts.push(item);
                                        } else {
                                            if (currentGroup) grouped.push(currentGroup);
                                            currentGroup = {
                                                type: 'dest-group',
                                                destId: item.destId,
                                                parts: [item],
                                                sample: item
                                            };
                                        }
                                    }
                                });
                                if (currentGroup) grouped.push(currentGroup);

                                return grouped.map((group, gIdx) => {
                                    if (group.type === 'dayNote') {
                                        return (
                                            <div key={group.id} className="pdf-day-general-note" style={{ background: '#fff9e6', border: '1.5px solid black', padding: '15px', borderRadius: '10px', marginBottom: '25px' }}>
                                                <div style={{ color: '#000', fontSize: '1rem', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>DAY {group.day} SPECIAL HIGHLIGHTS</div>
                                                <ul style={{ listStyleType: 'disc', paddingLeft: '20px', fontSize: '1.05rem', color: '#1a202c', lineHeight: '1.6', margin: 0 }}>
                                                    {(group.text || '').split('\n').filter(line => line.trim()).map((line, i) => (
                                                        <li key={i} style={{ marginBottom: '5px', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal' }}>{line.trim()}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        );
                                    }

                                    const hasHead = group.parts.some(p => p.type === 'dest-head');
                                    const headItem = group.parts.find(p => p.type === 'dest-head');
                                    const dayKey = `day-${group.sample.day}`;
                                    const showDayLabel = !renderedDayLabels.has(dayKey);
                                    if (showDayLabel) {
                                        renderedDayLabels.add(dayKey);
                                    }
                                    const dayText = `DAY ${String(group.sample.day).padStart(2, '0')}`;

                                    return (
                                        <div key={`${group.destId}-${gIdx}`} className="pdf-day-item" style={{ marginBottom: '20px' }}>
                                            <div className="pdf-day-header" style={{ marginBottom: hasHead ? '12px' : '4px', borderBottom: hasHead ? '2px solid #f8f8f8' : 'none' }}>
                                                {showDayLabel && (
                                                    <div className="day-number" style={{ fontSize: hasHead ? '2.2rem' : '1.2rem', whiteSpace: 'nowrap' }}>
                                                        {dayText}
                                                    </div>
                                                )}
                                                <div className="day-title-wrapper">
                                                    {hasHead && (
                                                        <h2 style={{ fontSize: '1.8rem' }}>
                                                            {group.sample.name}
                                                        </h2>
                                                    )}
                                                    {hasHead && <div className="day-subtitle">{headItem.title}</div>}
                                                </div>
                                            </div>

                                            <div className="pdf-day-content" style={{ display: hasHead ? 'grid' : 'block' }}>
                                                {hasHead && (
                                                    <div className="pdf-day-image-wrapper">
                                                        <img
                                                            src={customImages[headItem.destId] || headItem.image}
                                                            alt={headItem.name}
                                                            className="pdf-day-image"
                                                            style={{ height: headItem.image2 ? '135px' : '200px', marginBottom: headItem.image2 ? '10px' : '0' }}
                                                        />
                                                        {headItem.image2 && (
                                                            <img
                                                                src={customImages[`${headItem.destId}-2`] || headItem.image2}
                                                                alt={`${headItem.name} 2`}
                                                                className="pdf-day-image"
                                                                style={{ height: '135px' }}
                                                            />
                                                        )}
                                                    </div>
                                                )}
                                                <div className="pdf-day-description" style={{ flex: 1 }}>
                                                    {(() => {
                                                        const paraParts = group.parts.filter(p => p.type === 'dest-para');
                                                        return paraParts.map((para, pIdx) => (
                                                            <p key={pIdx} style={{ whiteSpace: 'pre-line', marginBottom: pIdx === paraParts.length - 1 ? 0 : '10px' }}>
                                                                {para.text}
                                                            </p>
                                                        ));
                                                    })()}
                                                </div>
                                            </div>
                                            {group.parts.some(p => p.type === 'dest-highlight-point') && (
                                                <div className="pdf-sub-places" style={{ marginTop: '10px', width: '100%' }}>
                                                    <ul style={{ listStyleType: 'disc', paddingLeft: '18px', marginLeft: 0, textAlign: 'left' }}>
                                                        {group.parts.filter(p => p.type === 'dest-highlight-point').map((pointItem, sIdx) => {
                                                            const sub = pointItem.highlight;
                                                            const rawSubName = typeof sub === 'string' ? sub : sub.name;
                                                            const subName = rawSubName.charAt(0).toUpperCase() + rawSubName.slice(1).toLowerCase();
                                                            const subDesc = typeof sub === 'string' ? '' : sub.description;
                                                            return (
                                                                <li key={sIdx} style={{ marginBottom: '10px', lineHeight: '1.5', textAlign: 'left' }}>
                                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                                                        <span style={{ fontWeight: '700', color: '#1a365d', fontSize: '0.9rem' }}>{subName}</span>
                                                                        {subDesc && (
                                                                            <div style={{ fontSize: '0.85rem', color: '#4a5568', marginTop: '4px', lineHeight: '1.4', wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                                                                {subDesc}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </li>
                                                            );
                                                        })}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    );
                                });
                            })()}
                            </div>
                        </div>

                        {pageIndex === pages.length - 1 && (
                            <div className="pdf-footer-premium pdf-fixed-footer">
                                <div className="footer-top">
                                    <div className="footer-brand">
                                        <h3>INVEL HOLIDAYS SRI LANKA</h3>
                                        <p>www.invelsrilanka.com</p>
                                        <p style={{ fontSize: '0.75rem', marginTop: '10px', opacity: 0.8 }}>(c) {new Date().getFullYear()} Invel Holidays - Where Journeys Become Stories</p>
                                    </div>
                                    <div className="footer-contact-grid">
                                        <div className="contact-item">
                                            <MapPin size={10} style={{ marginRight: '5px' }} />
                                            No. 197/43A, Vihara Mawatha, Athurugiriya, Sri Lanka.
                                        </div>
                                        <div className="contact-item">
                                            <Globe size={10} style={{ marginRight: '5px' }} />
                                            invelholidays@gmail.com
                                        </div>
                                        <div className="contact-item">
                                            <Phone size={10} style={{ marginRight: '5px' }} />
                                            +94 11 588 2489
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </PDFPage>
                    {pageIndex < pages.length - 1 && isPreview && (
                        <div className="page-break-indicator">Next Page</div>
                    )}
                </div>
            ))}
            {includeRouteMapPage && routeMapPlan && (
                <div key="route-map-pdf-page">
                    <RouteMapPdfPage plan={routeMapPlan} />
                </div>
            )}
        </div>
    );
};

export default App;

