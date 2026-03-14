const PX_TOLERANCE = 1.5;
const OVERFLOW_TOLERANCE = 1;
const FOOTER_SAFETY_CLEARANCE_MM = 2;
const A4_HEIGHT_MM = 297;

const hasRenderableBox = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
};

const isInside = (inner, outer, tolerance = PX_TOLERANCE) => (
    inner.left >= outer.left - tolerance
    && inner.top >= outer.top - tolerance
    && inner.right <= outer.right + tolerance
    && inner.bottom <= outer.bottom + tolerance
);

const overlaps = (a, b, tolerance = 0.5) => (
    a.left < b.right - tolerance
    && a.right > b.left + tolerance
    && a.top < b.bottom - tolerance
    && a.bottom > b.top + tolerance
);

const outsideDistance = (inner, outer) => {
    const left = Math.max(0, outer.left - inner.left);
    const top = Math.max(0, outer.top - inner.top);
    const right = Math.max(0, inner.right - outer.right);
    const bottom = Math.max(0, inner.bottom - outer.bottom);
    return Math.max(left, top, right, bottom);
};

const mmToPx = (mm, pageRect) => {
    if (!pageRect?.height) return 0;
    return (mm / A4_HEIGHT_MM) * pageRect.height;
};

export const validatePdfLayout = (container) => {
    const errors = [];
    if (!container) {
        return { ok: false, errors: ['PDF container not found'] };
    }

    const pages = Array.from(container.querySelectorAll('.pdf-page'));
    if (pages.length === 0) {
        return { ok: false, errors: ['No PDF pages found'] };
    }

    const expectedMargins = [];
    const multiplePages = pages.length > 1;

    pages.forEach((page, pageIndex) => {
        const border = page.querySelector(':scope > .pdf-page-border');
        const pageContent = page.querySelector(':scope > .pdf-page-content');
        const header = page.querySelector('[data-pdf-role="header"]');
        const body = page.querySelector('[data-pdf-role="body"]');
        const footer = page.querySelector('[data-pdf-role="footer"]');
        const generatedStamp = page.querySelector('[data-pdf-role="generated-stamp"]');
        const footerExceptionTag = page.getAttribute('data-footer-exception');

        if (!border) errors.push(`Page ${pageIndex + 1}: missing page border`);
        if (!pageContent) errors.push(`Page ${pageIndex + 1}: missing page content area`);
        if (!body) errors.push(`Page ${pageIndex + 1}: missing body area`);

        const shouldHaveHeader = multiplePages ? pageIndex === 0 : true;
        const shouldHaveFooter = multiplePages ? pageIndex === pages.length - 1 : footerExceptionTag !== 'single-fit';
        if (Boolean(header) !== shouldHaveHeader) {
            errors.push(`Page ${pageIndex + 1}: header placement rule failed`);
        }
        if (Boolean(footer) !== shouldHaveFooter) {
            errors.push(`Page ${pageIndex + 1}: footer placement rule failed`);
        }

        if (!multiplePages && footerExceptionTag === 'single-fit' && Boolean(footer)) {
            errors.push(`Page ${pageIndex + 1}: invalid single-page footer exception`);
        }
        if (multiplePages && footerExceptionTag === 'single-fit') {
            errors.push(`Page ${pageIndex + 1}: single-page footer exception used in multi-page PDF`);
        }

        if (!border || !pageContent) return;

        const pageRect = page.getBoundingClientRect();
        const borderRect = border.getBoundingClientRect();
        const contentRect = pageContent.getBoundingClientRect();

        const pageMargins = {
            top: borderRect.top - pageRect.top,
            right: pageRect.right - borderRect.right,
            bottom: pageRect.bottom - borderRect.bottom,
            left: borderRect.left - pageRect.left,
        };
        expectedMargins.push(pageMargins);

        // Tolerate tiny border-stroke / subpixel drift without weakening body overflow checks.
        if (outsideDistance(contentRect, borderRect) > 2.5) {
            errors.push(`Page ${pageIndex + 1}: content area exceeds border area`);
        }

        if (generatedStamp) {
            const stampRect = generatedStamp.getBoundingClientRect();
            const stampInsidePage =
                stampRect.left >= pageRect.left - PX_TOLERANCE
                && stampRect.right <= pageRect.right + PX_TOLERANCE
                && stampRect.top >= pageRect.top - PX_TOLERANCE
                && stampRect.bottom <= pageRect.bottom + PX_TOLERANCE;
            if (!stampInsidePage) {
                errors.push(`Page ${pageIndex + 1}: generated stamp leaves page bounds`);
            }

            // Approved exception position: top strip above the printable border.
            if (stampRect.bottom > borderRect.top + PX_TOLERANCE) {
                errors.push(`Page ${pageIndex + 1}: generated stamp is outside approved position`);
            }
        }

        if (header && body) {
            const headerRect = header.getBoundingClientRect();
            const bodyRect = body.getBoundingClientRect();
            if (!isInside(headerRect, borderRect)) {
                errors.push(`Page ${pageIndex + 1}: header crosses border`);
            }
            if (!isInside(bodyRect, borderRect)) {
                errors.push(`Page ${pageIndex + 1}: body crosses border`);
            }
            if (headerRect.bottom > bodyRect.top + 0.5 || overlaps(headerRect, bodyRect)) {
                errors.push(`Page ${pageIndex + 1}: body overlaps header`);
            }
        } else if (body) {
            const bodyRect = body.getBoundingClientRect();
            if (!isInside(bodyRect, borderRect)) {
                errors.push(`Page ${pageIndex + 1}: body crosses border`);
            }
        }

        const safeBottomLimitPx = borderRect.bottom - mmToPx(FOOTER_SAFETY_CLEARANCE_MM, pageRect);
        if (footer) {
            const footerRect = footer.getBoundingClientRect();
            if (!isInside(footerRect, borderRect)) {
                errors.push(`Page ${pageIndex + 1}: footer crosses border`);
            }
            if (body) {
                const bodyRect = body.getBoundingClientRect();
                if (bodyRect.bottom > footerRect.top + 0.5 || overlaps(bodyRect, footerRect)) {
                    errors.push(`Page ${pageIndex + 1}: body overlaps footer`);
                }
            }
        }

        if (body) {
            const bodyRect = body.getBoundingClientRect();
            if (bodyRect.bottom > safeBottomLimitPx + 0.5) {
                errors.push(`Page ${pageIndex + 1}: body violates 2mm bottom safety limit`);
            }
        }

        if (body) {
            if ((body.scrollHeight - body.clientHeight) > OVERFLOW_TOLERANCE) {
                errors.push(`Page ${pageIndex + 1}: body content overflows vertically`);
            }
            if ((body.scrollWidth - body.clientWidth) > OVERFLOW_TOLERANCE) {
                errors.push(`Page ${pageIndex + 1}: body content overflows horizontally`);
            }
        }

        const nodes = body ? Array.from(body.querySelectorAll('*')) : [];
        nodes.forEach((node) => {
            if (!hasRenderableBox(node)) return;
            if (node.tagName === 'SVG' || node.tagName === 'PATH') return;
            const rect = node.getBoundingClientRect();
            if (!isInside(rect, borderRect)) {
                errors.push(`Page ${pageIndex + 1}: element leaves printable border`);
            }
            if (rect.bottom > safeBottomLimitPx + 0.5) {
                errors.push(`Page ${pageIndex + 1}: element violates 2mm bottom safety limit`);
            }
        });
    });

    if (expectedMargins.length > 1) {
        const baseline = expectedMargins[0];
        expectedMargins.slice(1).forEach((m, idx) => {
            const p = idx + 2;
            if (
                Math.abs(m.top - baseline.top) > PX_TOLERANCE
                || Math.abs(m.right - baseline.right) > PX_TOLERANCE
                || Math.abs(m.bottom - baseline.bottom) > PX_TOLERANCE
                || Math.abs(m.left - baseline.left) > PX_TOLERANCE
            ) {
                errors.push(`Page ${p}: border spacing differs from page 1`);
            }
        });
    }

    return { ok: errors.length === 0, errors };
};

export const ensurePdfLayoutValid = (container, label = 'PDF') => {
    const result = validatePdfLayout(container);
    if (!result.ok) {
        const compact = result.errors.slice(0, 6).join(' | ');
        throw new Error(`${label} layout validation failed: ${compact}`);
    }
};
