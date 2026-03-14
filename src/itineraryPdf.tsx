import React from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { MapPin, Globe, Phone } from 'lucide-react';
import { RouteMapPdfPage } from './components/RouteMapPlanner';
import { ensurePdfLayoutValid } from './pdfLayoutValidation';
import { ItineraryPdfBlock } from './itineraryPdfBlocks';

type AnyRecord = Record<string, any>;

type PageData = AnyRecord | AnyRecord[];

interface ItineraryPdfContentProps {
    pages: PageData[];
    arrivalDate?: string;
    departureDate?: string;
    useTravelDates?: boolean;
    manualDaysCount?: number | string;
    manualNightsCount?: number | string;
    tripStart?: string;
    tripEnd?: string;
    flightDetails?: string;
    customImages: Record<string, string>;
    isPreview?: boolean;
    generationTime?: string | null;
    showDayNote?: Record<number, boolean>;
    dayNoteText?: Record<number, string>;
    includeRouteMapPage?: boolean;
    routeMapPlan?: AnyRecord | null;
}

interface RouteMapPlanLike extends AnyRecord {
    attachToFinalPdf?: boolean;
    mapSnapshot?: string;
}

interface GenerateItineraryPdfOptions {
    containerId: string;
    routeMapPlan?: RouteMapPlanLike | null;
    routeMapPlanRefCurrent?: RouteMapPlanLike | null;
    forcedRouteMapSnapshot?: string;
    forceAttachRoutePlan?: boolean;
    routeMapSnapshotKey: string;
    setRouteMapPlan?: React.Dispatch<React.SetStateAction<AnyRecord>>;
}

type GenerateItineraryPdfResult = 'saved' | 'container-missing' | 'no-content';

const PDFPage = ({
    children,
    generationTime,
    footerExceptionApplied = false,
}: {
    children: React.ReactNode;
    generationTime?: string | null;
    footerExceptionApplied?: boolean;
}) => (
    <div
        className="pdf-page"
        data-footer-exception={footerExceptionApplied ? 'single-fit' : 'none'}
    >
        <div className="pdf-page-border"></div>
        {generationTime && (
            <div
                className="pdf-generated-stamp"
                data-pdf-role="generated-stamp"
                style={{
                    position: 'absolute',
                    right: '10px',
                    top: '1px',
                    fontSize: '0.58rem',
                    lineHeight: 1.1,
                    margin: 0,
                    padding: 0,
                    opacity: 0.8,
                    fontStyle: 'italic',
                    color: 'var(--text-light)',
                    whiteSpace: 'nowrap',
                    zIndex: 100,
                }}
            >
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

export const ItineraryPDFContent = ({
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
    includeRouteMapPage = false,
    routeMapPlan = null,
}: ItineraryPdfContentProps) => {
    const calculateTourHeading = () => {
        let days = 0;
        let nights = 0;

        if (useTravelDates && arrivalDate && departureDate) {
            const start = new Date(arrivalDate);
            const end = new Date(departureDate);
            days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            nights = Math.max(0, days - 1);
        } else {
            days = Math.max(1, parseInt(String(manualDaysCount), 10) || 1);
            nights = Math.max(0, parseInt(String(manualNightsCount), 10) || 0);
        }

        return `${String(nights).padStart(2, '0')} NIGHTS ${String(days).padStart(2, '0')} DAYS TOUR ITINERARY TO SRI LANKA`;
    };

    const renderedDayLabels = new Set<string>();

    return (
        <div className="pdf-preview-container">
            {pages.map((pageData, pageIndex) => {
                const pageDataObj = Array.isArray(pageData) ? undefined : pageData;
                const items = Array.isArray(pageData)
                    ? pageData
                    : (Array.isArray(pageDataObj?.items) ? pageDataObj.items : []);
                const blocks = Array.isArray(pageDataObj?.blocks) ? pageDataObj.blocks : null;
                const shouldRenderHeader = typeof pageDataObj?.showHeader === 'boolean'
                    ? pageDataObj.showHeader
                    : pageIndex === 0;
                const shouldRenderFooter = typeof pageDataObj?.showFooter === 'boolean'
                    ? pageDataObj.showFooter
                    : pageIndex === pages.length - 1;
                const footerExceptionApplied = Boolean(pageDataObj?.footerExceptionApplied);

                return (
                    <div key={pageIndex}>
                        <PDFPage
                            generationTime={generationTime}
                            footerExceptionApplied={footerExceptionApplied}
                        >
                            {shouldRenderHeader && (
                                <div className="pdf-fixed-header" data-pdf-role="header">
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
                                                color: '#1a365d',
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
                                                                <span className="value">{Math.max(1, parseInt(String(manualDaysCount), 10) || 1)}</span>
                                                            </div>
                                                            <div className="pdf-date-badge">
                                                                <span className="label">NIGHTS COUNT</span>
                                                                <span className="value">{Math.max(0, parseInt(String(manualNightsCount), 10) || 0)}</span>
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

                            <div className="pdf-fixed-content" data-pdf-role="body">
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
                                    {blocks ? blocks.map((block: AnyRecord, idx: number) => (
                                        <ItineraryPdfBlock key={block.id || `${pageIndex}-block-${idx}`} block={block} />
                                    )) : (() => {
                                        const grouped: AnyRecord[] = [];
                                        let currentGroup: AnyRecord | null = null;

                                        items.forEach((item: AnyRecord) => {
                                            if (item.type === 'dayNote') {
                                                if (currentGroup) {
                                                    grouped.push(currentGroup);
                                                    currentGroup = null;
                                                }
                                                grouped.push(item);
                                            } else {
                                                if (currentGroup && currentGroup.destId === item.destId && currentGroup.day === item.day) {
                                                    currentGroup.parts.push(item);
                                                } else {
                                                    if (currentGroup) grouped.push(currentGroup);
                                                    currentGroup = {
                                                        type: 'dest-group',
                                                        destId: item.destId,
                                                        day: item.day,
                                                        parts: [item],
                                                        sample: item,
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
                                                            {(group.text || '').split('\n').filter((line: string) => line.trim()).map((line: string, i: number) => (
                                                                <li key={i} style={{ marginBottom: '5px', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal' }}>{line.trim()}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                );
                                            }

                                            const hasHead = group.parts.some((p: AnyRecord) => p.type === 'dest-head');
                                            const headItem = group.parts.find((p: AnyRecord) => p.type === 'dest-head');
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
                                                                const paraParts = group.parts.filter((p: AnyRecord) => p.type === 'dest-para');
                                                                return paraParts.map((para: AnyRecord, pIdx: number) => (
                                                                    <p key={pIdx} style={{ whiteSpace: 'pre-line', marginBottom: pIdx === paraParts.length - 1 ? 0 : '10px' }}>
                                                                        {para.text}
                                                                    </p>
                                                                ));
                                                            })()}
                                                        </div>
                                                    </div>
                                                    {group.parts.some((p: AnyRecord) => p.type === 'dest-highlight-point') && (
                                                        <div className="pdf-sub-places" style={{ marginTop: '10px', width: '100%' }}>
                                                            <ul style={{ listStyleType: 'disc', paddingLeft: '18px', marginLeft: 0, textAlign: 'left' }}>
                                                                {group.parts.filter((p: AnyRecord) => p.type === 'dest-highlight-point').map((pointItem: AnyRecord, sIdx: number) => {
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
                                                    {group.parts.some((p: AnyRecord) => p.type === 'city-note-point') && (
                                                        <div style={{ marginTop: '10px', width: '100%', background: '#eef8ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 12px' }}>
                                                            <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#1e3a8a', textTransform: 'uppercase', marginBottom: '6px' }}>
                                                                City Special Note
                                                            </div>
                                                            <ul style={{ listStyleType: 'disc', paddingLeft: '18px', margin: 0, textAlign: 'left' }}>
                                                                {group.parts
                                                                    .filter((p: AnyRecord) => p.type === 'city-note-point')
                                                                    .map((notePart: AnyRecord) => (notePart.text || '').trim())
                                                                    .filter(Boolean)
                                                                    .map((line: string, lineIdx: number) => (
                                                                        <li key={lineIdx} style={{ marginBottom: '6px', fontSize: '0.88rem', color: '#1e293b', lineHeight: '1.45' }}>
                                                                            {line.trim()}
                                                                        </li>
                                                                    ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>

                            {shouldRenderFooter && (
                                <div className="pdf-footer-premium pdf-fixed-footer" data-pdf-role="footer">
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
                );
            })}
            {includeRouteMapPage && routeMapPlan && (
                <div key="route-map-pdf-page">
                    <RouteMapPdfPage plan={routeMapPlan} />
                </div>
            )}
        </div>
    );
};

const resolveImageSize = (source: string): Promise<{ width: number; height: number }> => (
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        img.onerror = () => reject(new Error('Route map image load failed'));
        img.src = source;
    })
);

const waitForFontsAndImages = async (container: HTMLElement): Promise<void> => {
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
        try {
            await (document as any).fonts.ready;
        } catch (_err) {
            // Ignore font API failures and continue with image checks.
        }
    }

    const images = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
    if (images.length === 0) return;

    await Promise.all(images.map((img) => new Promise<void>((resolve) => {
        if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
        }
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
    })));
};

export const generateItineraryPdf = async ({
    containerId,
    routeMapPlan,
    routeMapPlanRefCurrent,
    forcedRouteMapSnapshot = '',
    forceAttachRoutePlan = false,
    routeMapSnapshotKey,
    setRouteMapPlan,
}: GenerateItineraryPdfOptions): Promise<GenerateItineraryPdfResult> => {
    const latestRouteMapPlan = routeMapPlanRefCurrent || routeMapPlan || null;
    const safeForcedSnapshot = typeof forcedRouteMapSnapshot === 'string' ? forcedRouteMapSnapshot : '';
    const safeForceAttach = forceAttachRoutePlan === true;

    const container = document.getElementById(containerId);
    if (!container) return 'container-missing';

    await waitForFontsAndImages(container);

    const pageElements = Array.from(container.querySelectorAll('.pdf-page')) as HTMLElement[];
    if (pageElements.length === 0) return 'no-content';

    ensurePdfLayoutValid(container, 'Itinerary PDF');

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < pageElements.length; i++) {
        if (i > 0) pdf.addPage();

        const canvas = await html2canvas(pageElements[i], {
            scale: 1.5,
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
        if (!hiddenHasRouteMapPage) {
            let persistedSnapshot = '';
            try {
                persistedSnapshot = localStorage.getItem(routeMapSnapshotKey) || '';
            } catch (_err) {
                persistedSnapshot = '';
            }

            const routeMapSnapshot = safeForcedSnapshot || persistedSnapshot || latestRouteMapPlan?.mapSnapshot || '';
            if (routeMapSnapshot) {
                if (routeMapSnapshot !== latestRouteMapPlan?.mapSnapshot && setRouteMapPlan) {
                    setRouteMapPlan((prev: AnyRecord) => ({
                        ...(prev || {}),
                        mapSnapshot: routeMapSnapshot,
                    }));
                }

                pdf.addPage();
                const marginX = 8;
                const marginY = 8;
                const mapImgType = routeMapSnapshot.startsWith('data:image/png') ? 'PNG' : 'JPEG';
                const imageSize = await resolveImageSize(routeMapSnapshot);
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
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    pdf.save(`Invel-Sri-Lanka-Itinerary-${dateStr}.pdf`);
    return 'saved';
};

export default ItineraryPDFContent;
