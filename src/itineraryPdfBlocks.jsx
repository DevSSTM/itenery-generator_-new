import React from 'react';

const formatSubName = (raw) => {
    const text = String(raw || '').trim();
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

export const ItineraryPdfBlock = ({ block }) => {
    if (!block) return null;

    if (block.type === 'dayNote') {
        return (
            <div
                className="pdf-day-general-note"
                style={{
                    background: '#fff9e6',
                    border: '1.5px solid black',
                    padding: '15px',
                    borderRadius: '10px',
                    marginBottom: '20px',
                }}
            >
                <div style={{ color: '#000', fontSize: '1rem', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>
                    DAY {block.day} SPECIAL HIGHLIGHTS
                </div>
                <ul style={{ listStyleType: 'disc', paddingLeft: '20px', fontSize: '1.05rem', color: '#1a202c', lineHeight: '1.6', margin: 0 }}>
                    {(block.lines || []).map((line, idx) => (
                        <li key={`${block.id}-line-${idx}`} style={{ marginBottom: '5px', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal' }}>
                            {line}
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    const hasHead = block.showHeading === true;
    const heading = (
        <div className="pdf-day-header" style={{ marginBottom: hasHead ? '12px' : '4px', borderBottom: hasHead ? '2px solid #f8f8f8' : 'none' }}>
            {block.showDayLabel && (
                <div className="day-number" style={{ fontSize: hasHead ? '2.2rem' : '1.2rem', whiteSpace: 'nowrap' }}>
                    DAY {String(block.day).padStart(2, '0')}
                </div>
            )}
            <div className="day-title-wrapper">
                {hasHead && (
                    <h2 style={{ fontSize: '1.8rem' }}>
                        {block.cityName}
                    </h2>
                )}
                {hasHead && block.cityTitle && <div className="day-subtitle">{block.cityTitle}</div>}
            </div>
        </div>
    );

    return (
        <div className="pdf-day-item" style={{ marginBottom: '20px' }}>
            {(block.showDayLabel || hasHead) && heading}

            {hasHead && (
                <div className="pdf-day-content" style={{ display: 'grid' }}>
                    <div className="pdf-day-image-wrapper">
                        <img
                            src={block.image}
                            alt={block.cityName}
                            className="pdf-day-image"
                            style={{ height: block.image2 ? '135px' : '200px', marginBottom: block.image2 ? '10px' : '0' }}
                        />
                        {block.image2 && (
                            <img
                                src={block.image2}
                                alt={`${block.cityName} 2`}
                                className="pdf-day-image"
                                style={{ height: '135px' }}
                            />
                        )}
                    </div>
                    <div className="pdf-day-description" style={{ flex: 1 }}>
                        {(block.paragraphs || []).map((para, idx) => (
                            <p key={`${block.id}-p-${idx}`} style={{ whiteSpace: 'pre-line', marginBottom: idx === (block.paragraphs || []).length - 1 ? 0 : '10px' }}>
                                {para}
                            </p>
                        ))}
                    </div>
                </div>
            )}

            {!hasHead && (block.paragraphs || []).length > 0 && (
                <div className="pdf-day-description" style={{ marginTop: '2px' }}>
                    {(block.paragraphs || []).map((para, idx) => (
                        <p key={`${block.id}-pc-${idx}`} style={{ whiteSpace: 'pre-line', marginBottom: idx === (block.paragraphs || []).length - 1 ? 0 : '10px' }}>
                            {para}
                        </p>
                    ))}
                </div>
            )}

            {(block.highlights || []).length > 0 && (
                <div className="pdf-sub-places" style={{ marginTop: '10px', width: '100%' }}>
                    <ul style={{ listStyleType: 'disc', paddingLeft: '18px', marginLeft: 0, textAlign: 'left' }}>
                        {(block.highlights || []).map((sub, idx) => {
                            const subName = formatSubName(sub?.name || sub);
                            const subDesc = typeof sub === 'string' ? '' : (sub?.description || '');
                            return (
                                <li key={`${block.id}-h-${idx}`} style={{ marginBottom: '10px', lineHeight: '1.5', textAlign: 'left' }}>
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

            {(block.cityNotes || []).length > 0 && (
                <div style={{ marginTop: '10px', width: '100%', background: '#eef8ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: '700', color: '#1e3a8a', textTransform: 'uppercase', marginBottom: '6px' }}>
                        City Special Note
                    </div>
                    <ul style={{ listStyleType: 'disc', paddingLeft: '18px', margin: 0, textAlign: 'left' }}>
                        {(block.cityNotes || []).map((line, idx) => (
                            <li key={`${block.id}-n-${idx}`} style={{ marginBottom: '6px', fontSize: '0.88rem', color: '#1e293b', lineHeight: '1.45' }}>
                                {line}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

