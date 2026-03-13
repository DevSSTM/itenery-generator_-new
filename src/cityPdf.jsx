import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { MapPin, Globe, Phone } from 'lucide-react';
import { ensurePdfLayoutValid } from './pdfLayoutValidation';
import { TypeScriptPdfLayoutEngine } from './pdf-engine';

export const CITY_PDF_CONTAINER_ID = 'hidden-city-pdf-content';

const CityPdfPage = ({ children, footerExceptionApplied = false }) => (
    <div
        className="pdf-page"
        data-footer-exception={footerExceptionApplied ? 'single-fit' : 'none'}
    >
        <div className="pdf-page-border"></div>
        <div className="pdf-page-content">
            <div className="pdf-page-inner">
                {children}
            </div>
        </div>
    </div>
);

const buildCityFlowItems = (place) => {
    const description = (place?.effectiveDescription || place?.description || '').trim();
    const paragraphs = description.split('\n').filter(p => p.trim());
    const subPlaces = Array.isArray(place?.subPlaces) ? place.subPlaces : [];

    const items = [];
    items.push({
        type: 'city-head',
        name: place?.name || '',
        title: place?.title || '',
        image: place?.image || '',
        image2: place?.image2 || ''
    });

    paragraphs.forEach((text) => {
        items.push({ type: 'city-para', text });
    });

    subPlaces.forEach((sub) => {
        const subName = typeof sub === 'string' ? sub : (sub?.name || '');
        const subDesc = typeof sub === 'string' ? '' : (sub?.description || '');
        if (subName.trim()) {
            items.push({ type: 'city-point', subName, subDesc });
        }
    });

    return items;
};

const paginateCityFlow = (flowItems) => {
    const getItemWeight = (item) => {
        if (item.type === 'city-head') return item.image2 ? 2.0 : 1.75;
        if (item.type === 'city-para') return Math.max(0.07, (item.text || '').length / 1250);
        if (item.type === 'city-point') {
            const pointLen = `${item.subName || ''} ${item.subDesc || ''}`.trim().length;
            const estimatedLines = Math.max(1, Math.ceil(pointLen / 96));
            return Math.max(0.2, 0.12 + (pointLen / 860) + (estimatedLines * 0.03));
        }
        return 0.2;
    };

    const MM_PER_WEIGHT = 38;
    const planner = new TypeScriptPdfLayoutEngine({
        page: { width: 210, height: 297 },
        margins: { top: 5, right: 5, bottom: 2, left: 5 },
        headerHeightMm: 52,
        footerHeightMm: 20,
        blockGapMm: 2,
        footerVisibility: 'last-and-single',
    });

    const blocks = flowItems.map((item, index) => ({
        id: `city-${index}`,
        heightMm: Math.max(8, getItemWeight(item) * MM_PER_WEIGHT),
        keepTogether: true,
        splittable: false,
        payload: { index },
    }));

    let plan;
    try {
        plan = planner.layout(blocks);
    } catch (_err) {
        return [{ items: flowItems, showHeader: true, showFooter: true, footerExceptionApplied: false }];
    }
    if (!plan.valid) {
        return [{ items: flowItems, showHeader: true, showFooter: true, footerExceptionApplied: false }];
    }

    const itemById = new Map(flowItems.map((item, idx) => [`city-${idx}`, item]));
    const pages = plan.pages.map((page) => ({
        items: page.blocks
            .map((b) => itemById.get(b.sourceId))
            .filter(Boolean),
        showHeader: page.showHeader,
        showFooter: page.showFooter,
        footerExceptionApplied: Boolean(page.footerExceptionApplied),
    }));

    return pages.length > 0 ? pages : [{ items: [], showHeader: true, showFooter: true, footerExceptionApplied: false }];
};

const CityPdfHeader = () => (
    <div className="pdf-header-premium" style={{ marginBottom: '16px' }}>
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
                fontSize: '1.15rem',
                color: '#1a365d',
                letterSpacing: '1px'
            }}>
                INVEL HOLIDAYS SRI LANKA
            </div>
        </div>
    </div>
);

const CityPdfFooter = () => (
    <div className="pdf-footer-premium">
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
);

export const CityPDFContent = ({ place }) => {
    if (!place) return null;

    const flowItems = buildCityFlowItems(place);
    const pages = paginateCityFlow(flowItems);

    return (
        <div className="pdf-preview-container">
            {pages.map((pageData, pageIndex) => {
                const pageItems = Array.isArray(pageData)
                    ? pageData
                    : (Array.isArray(pageData?.items) ? pageData.items : []);
                const shouldRenderHeader = typeof pageData?.showHeader === 'boolean'
                    ? pageData.showHeader
                    : pageIndex === 0;
                const shouldRenderFooter = typeof pageData?.showFooter === 'boolean'
                    ? pageData.showFooter
                    : pageIndex === pages.length - 1;
                const footerExceptionApplied = Boolean(pageData?.footerExceptionApplied);
                const headItem = pageItems.find(item => item.type === 'city-head');
                const paragraphs = pageItems.filter(item => item.type === 'city-para').map(item => item.text);
                const points = pageItems.filter(item => item.type === 'city-point');
                const showImages = Boolean(headItem);

                return (
                    <div key={`city-page-${pageIndex}`}>
                        <CityPdfPage footerExceptionApplied={footerExceptionApplied}>
                            {shouldRenderHeader && (
                                <div className="pdf-fixed-header city-pdf-fixed-header" data-pdf-role="header">
                                    <CityPdfHeader />
                                </div>
                            )}

                            <div className="pdf-fixed-content city-pdf-fixed-content" data-pdf-role="body">
                                <div className="pdf-day-item" style={{ marginBottom: '16px' }}>
                                    {pageIndex === 0 && (
                                        <div className="pdf-day-header" style={{ marginBottom: '10px', borderBottom: '2px solid #f8f8f8' }}>
                                            <div className="day-title-wrapper">
                                                <h2 style={{ fontSize: showImages ? '1.8rem' : '1.35rem' }}>
                                                    {place.name}
                                                </h2>
                                                {showImages && place.title && <div className="day-subtitle">{place.title}</div>}
                                            </div>
                                        </div>
                                    )}

                                    {showImages ? (
                                        <div className="pdf-day-content" style={{ display: 'grid' }}>
                                            <div className="pdf-day-image-wrapper">
                                                <img
                                                    src={headItem.image}
                                                    alt={place.name}
                                                    className="pdf-day-image"
                                                    style={{ height: headItem.image2 ? '135px' : '210px', marginBottom: headItem.image2 ? '10px' : '0' }}
                                                />
                                                {headItem.image2 && (
                                                    <img
                                                        src={headItem.image2}
                                                        alt={`${place.name} 2`}
                                                        className="pdf-day-image"
                                                        style={{ height: '135px' }}
                                                    />
                                                )}
                                            </div>
                                            <div className="pdf-day-description" style={{ flex: 1 }}>
                                                <p style={{ whiteSpace: 'pre-line', textAlign: 'justify' }}>{paragraphs.join('\n\n')}</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="pdf-day-description" style={{ flex: 1 }}>
                                            <p style={{ whiteSpace: 'pre-line', textAlign: 'justify' }}>{paragraphs.join('\n\n')}</p>
                                        </div>
                                    )}

                                    {points.length > 0 && (
                                        <div style={{ marginTop: '12px' }}>
                                            {pageIndex === 0 && (
                                                <div style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--primary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left' }}>
                                                    Visiting Places
                                                </div>
                                            )}
                                            <ul style={{ listStyleType: 'disc', paddingLeft: '18px', margin: 0, textAlign: 'left' }}>
                                                {points.map((point, idx) => (
                                                    <li key={idx} style={{ marginBottom: '8px', lineHeight: '1.45' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                                            <span style={{ fontWeight: '700', color: '#1a365d', fontSize: '0.9rem' }}>{point.subName}</span>
                                                            {point.subDesc && (
                                                                <span style={{ fontSize: '0.82rem', color: '#4a5568', marginTop: '2px' }}>
                                                                    {point.subDesc}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {shouldRenderFooter && (
                                <div className="pdf-fixed-footer" data-pdf-role="footer">
                                    <CityPdfFooter />
                                </div>
                            )}
                        </CityPdfPage>
                    </div>
                );
            })}
        </div>
    );
};

export const downloadCityPdfFromContainer = async (containerId, placeName) => {
    const container = document.getElementById(containerId);
    if (!container) {
        throw new Error('City PDF container not found');
    }

    const pageElements = container.querySelectorAll('.pdf-page');
    if (!pageElements || pageElements.length === 0) {
        throw new Error('City PDF content is not ready');
    }

    ensurePdfLayoutValid(container, 'City PDF');

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
        const imgData = canvas.toDataURL('image/jpeg', 0.85);
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    }

    const slug = (placeName || 'city')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    pdf.save(`Invel-City-Details-${slug}.pdf`);
};
