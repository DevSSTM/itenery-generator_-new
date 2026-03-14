export type PageRole = 'single' | 'first' | 'middle' | 'last';

export interface PageSizeMm {
    width: number;
    height: number;
}

export interface MarginsMm {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface PdfLayoutTemplate {
    page: PageSizeMm;
    margins: MarginsMm;
    headerHeightMm: number;
    footerHeightMm: number;
    blockGapMm: number;
    bottomSafetyMm?: number;
    headerVisibility?: 'first-and-single' | 'every-page' | 'none';
    footerVisibility?: 'last-and-single' | 'every-page' | 'none';
}

export interface ContentBlock {
    id: string;
    heightMm: number;
    forcePageBreak?: boolean;
    keepTogether?: boolean;
    splittable?: boolean;
    minSplitHeightMm?: number;
    payload?: unknown;
}

export interface PlacedBlock {
    id: string;
    sourceId: string;
    heightMm: number;
    partIndex: number;
    isSplitPart: boolean;
    payload?: unknown;
}

export interface PlannedPage {
    pageNumber: number;
    role: PageRole;
    showHeader: boolean;
    showFooter: boolean;
    footerExceptionApplied?: boolean;
    bodyCapacityMm: number;
    usedBodyMm: number;
    freeBodyMm: number;
    blocks: PlacedBlock[];
}

export interface LayoutPlan {
    pages: PlannedPage[];
    errors: string[];
    valid: boolean;
}

export interface PdfRenderer {
    render(plan: LayoutPlan): Promise<Blob | Uint8Array>;
}

export interface RenderCandidate {
    key: string;
    description: string;
    searchableText: number;
    visualFidelity: number;
    performance: number;
    implementationSpeed: number;
    scoringWeight?: Partial<Record<'searchableText' | 'visualFidelity' | 'performance' | 'implementationSpeed', number>>;
}

const EPSILON = 0.0001;
const PDF_LAYOUT_DEBUG = (() => {
    const envDebug = typeof import.meta !== 'undefined'
        && Boolean((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PDF_LAYOUT_DEBUG === '1');
    if (envDebug) return true;
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem('pdfLayoutDebug') === '1';
    } catch {
        return false;
    }
})();

const sumHeights = (blocks: PlacedBlock[], gap: number): number => {
    if (blocks.length === 0) return 0;
    const content = blocks.reduce((s, b) => s + b.heightMm, 0);
    return content + gap * (blocks.length - 1);
};

const buildPlaced = (block: ContentBlock, partHeight: number, partIndex = 0, isSplitPart = false): PlacedBlock => ({
    id: `${block.id}::${partIndex}`,
    sourceId: block.id,
    heightMm: partHeight,
    partIndex,
    isSplitPart,
    payload: block.payload,
});

const clonePage = (template: Omit<PlannedPage, 'blocks' | 'usedBodyMm' | 'freeBodyMm'>): PlannedPage => ({
    ...template,
    blocks: [],
    usedBodyMm: 0,
    freeBodyMm: template.bodyCapacityMm,
});

export class TypeScriptPdfLayoutEngine {
    constructor(private readonly template: PdfLayoutTemplate) {}

    layout(blocks: ContentBlock[]): LayoutPlan {
        const sanitizedBlocks = blocks.filter((b) => b.forcePageBreak || b.heightMm > 0);
        if (sanitizedBlocks.length === 0) {
            const page = this.createEmptyPage(1, 'single');
            return this.validate({ pages: [page], errors: [], valid: true });
        }

        let pages = this.packAsFirstMiddle(sanitizedBlocks);
        pages = this.adjustForLastFooter(pages, sanitizedBlocks);
        pages = this.finalizeRoles(pages);

        return this.validate({ pages, errors: [], valid: true });
    }

    async generate(blocks: ContentBlock[], renderer: PdfRenderer): Promise<Blob | Uint8Array> {
        const plan = this.layout(blocks);
        if (!plan.valid) {
            throw new Error(`PDF layout validation failed: ${plan.errors.join(' | ')}`);
        }
        return renderer.render(plan);
    }

    validate(plan: LayoutPlan): LayoutPlan {
        const errors: string[] = [...plan.errors];
        const { margins, page } = this.template;

        plan.pages.forEach((p, index) => {
            if (p.bodyCapacityMm <= 0) errors.push(`Page ${index + 1}: non-positive body capacity`);
            if (p.usedBodyMm - p.bodyCapacityMm > EPSILON) errors.push(`Page ${index + 1}: body overflow`);
            if (p.freeBodyMm < -EPSILON) errors.push(`Page ${index + 1}: negative free space`);

            const expectedHeader = this.expectedHeaderForPosition(index, plan.pages.length);
            const expectedFooter = this.expectedFooterForPosition(index, plan.pages.length, p);
            if (p.showHeader !== expectedHeader) errors.push(`Page ${index + 1}: header placement rule failed`);
            if (p.showFooter !== expectedFooter) errors.push(`Page ${index + 1}: footer placement rule failed`);

            const printableWidth = page.width - margins.left - margins.right;
            const printableHeight = page.height - margins.top - margins.bottom;
            if (printableWidth <= 0 || printableHeight <= 0) errors.push('Invalid margin template: printable area is non-positive');
        });

        if (plan.pages.length > 1) {
            const baseline = this.template.margins;
            plan.pages.slice(1).forEach((_p, idx) => {
                const pageNumber = idx + 2;
                const sameMargins =
                    this.template.margins.top === baseline.top
                    && this.template.margins.right === baseline.right
                    && this.template.margins.bottom === baseline.bottom
                    && this.template.margins.left === baseline.left;
                if (!sameMargins) errors.push(`Page ${pageNumber}: margin mismatch`);
            });
        }

        return { ...plan, errors, valid: errors.length === 0 };
    }

    static recommendRenderer(
        candidates: RenderCandidate[],
        weights: Partial<Record<'searchableText' | 'visualFidelity' | 'performance' | 'implementationSpeed', number>> = {},
    ): RenderCandidate[] {
        const w = {
            searchableText: weights.searchableText ?? 0.35,
            visualFidelity: weights.visualFidelity ?? 0.3,
            performance: weights.performance ?? 0.2,
            implementationSpeed: weights.implementationSpeed ?? 0.15,
        };

        return [...candidates]
            .map((c) => {
                const local = { ...w, ...(c.scoringWeight || {}) };
                const score =
                    c.searchableText * local.searchableText
                    + c.visualFidelity * local.visualFidelity
                    + c.performance * local.performance
                    + c.implementationSpeed * local.implementationSpeed;
                return { ...c, _score: Number(score.toFixed(4)) };
            })
            .sort((a, b) => (b as RenderCandidate & { _score: number })._score - (a as RenderCandidate & { _score: number })._score)
            .map(({ _score, ...rest }) => rest as RenderCandidate);
    }

    private createEmptyPage(pageNumber: number, role: PageRole): PlannedPage {
        const bodyCapacity = this.bodyCapacityForRole(role);
        return clonePage({
            pageNumber,
            role,
            showHeader: this.showHeaderForRole(role),
            showFooter: this.showFooterForRole(role),
            footerExceptionApplied: false,
            bodyCapacityMm: bodyCapacity,
        });
    }

    private packAsFirstMiddle(blocks: ContentBlock[]): PlannedPage[] {
        const pages: PlannedPage[] = [];
        let page = this.createEmptyPage(1, 'first');
        pages.push(page);

        for (const block of blocks) {
            page = pages[pages.length - 1];

            if (block.forcePageBreak) {
                if (page.blocks.length === 0) continue;
                const next = this.createEmptyPage(pages.length + 1, 'middle');
                pages.push(next);
                continue;
            }

            const placed = this.tryPlaceBlock(page, block);
            if (placed) continue;

            const next = this.createEmptyPage(pages.length + 1, 'middle');
            pages.push(next);
            const placedNext = this.tryPlaceBlock(next, block);
            if (!placedNext) {
                throw new Error(`Block "${block.id}" cannot fit inside printable body area`);
            }
        }
        return pages;
    }

    private adjustForLastFooter(pages: PlannedPage[], sourceBlocks: ContentBlock[]): PlannedPage[] {
        if (pages.length === 1) {
            const usedMm = pages[0].usedBodyMm;

            if (this.canUseSinglePageFooterException(usedMm)) {
                this.debug('Applying single-page footer exception', {
                    usedMm: Number(usedMm.toFixed(2)),
                    capacityWithFooterMm: Number(this.bodyCapacityForSingle(true).toFixed(2)),
                    capacityWithoutFooterMm: Number(this.bodyCapacityForSingle(false).toFixed(2)),
                });
                return [this.buildSinglePage(pages[0].blocks, false)];
            }

            const single = this.createEmptyPage(1, 'single');
            const packed = this.repackBlocksIntoPages(sourceBlocks, ['single']);
            return packed.length > 0 ? packed : [single];
        }

        return this.repackBlocksIntoPages(sourceBlocks, ['first', 'middle', 'last']);
    }

    private repackBlocksIntoPages(sourceBlocks: ContentBlock[], roles: ('single' | 'first' | 'middle' | 'last')[]): PlannedPage[] {
        const pages: PlannedPage[] = [];
        let i = 0;
        while (i < sourceBlocks.length) {
            const pageIndex = pages.length;
            const role = this.roleForIndex(pageIndex, sourceBlocks.length, i, pages.length, roles);
            const page = this.createEmptyPage(pageIndex + 1, role);
            pages.push(page);

            while (i < sourceBlocks.length) {
                const current = sourceBlocks[i];
                if (current.forcePageBreak) {
                    i += 1;
                    if (page.blocks.length === 0) continue;
                    break;
                }
                if (!this.tryPlaceBlock(page, current)) break;
                i += 1;
            }

            if (page.blocks.length === 0 && i >= sourceBlocks.length) {
                pages.pop();
                break;
            }
            if (page.blocks.length === 0 && i < sourceBlocks.length) {
                throw new Error(`Unplaceable block during pagination: ${sourceBlocks[i].id}`);
            }
        }
        return pages;
    }

    private roleForIndex(
        pageIndex: number,
        totalBlocks: number,
        nextBlockIndex: number,
        totalPagesBuilt: number,
        roles: ('single' | 'first' | 'middle' | 'last')[],
    ): PageRole {
        if (roles.includes('single') && totalBlocks > 0 && nextBlockIndex === 0 && totalPagesBuilt === 0) {
            return 'single';
        }
        if (pageIndex === 0) return 'first';
        return 'middle';
    }

    private finalizeRoles(pages: PlannedPage[]): PlannedPage[] {
        if (pages.length === 1) {
            const single = pages[0];
            const usedMm = sumHeights(single.blocks, this.template.blockGapMm);
            const omitFooter = this.canUseSinglePageFooterException(usedMm);
            single.role = 'single';
            single.showHeader = this.showHeaderForRole('single');
            single.showFooter = omitFooter ? false : this.showFooterForRole('single');
            single.footerExceptionApplied = omitFooter;
            single.bodyCapacityMm = this.bodyCapacityForSingle(single.showFooter);
            single.usedBodyMm = usedMm;
            single.freeBodyMm = single.bodyCapacityMm - single.usedBodyMm;
            return pages;
        }

        const finalized = pages.map((page, idx) => {
            const role: PageRole = idx === 0 ? 'first' : (idx === pages.length - 1 ? 'last' : 'middle');
            const capacity = this.bodyCapacityForRole(role);
            const used = sumHeights(page.blocks, this.template.blockGapMm);
            return {
                ...page,
                role,
                showHeader: this.showHeaderForRole(role),
                showFooter: this.showFooterForRole(role),
                footerExceptionApplied: false,
                bodyCapacityMm: capacity,
                usedBodyMm: used,
                freeBodyMm: capacity - used,
            };
        });

        const overflowExists = finalized.some((p) => p.usedBodyMm - p.bodyCapacityMm > EPSILON);
        if (!overflowExists) return finalized;

        // Repack with true final roles to avoid "late" overflow after footer is introduced on the last page.
        const orderedBlocks = finalized.flatMap((p) => p.blocks);
        return this.repackPlacedBlocksForFinalRoles(orderedBlocks, Math.max(2, finalized.length));
    }

    private repackPlacedBlocksForFinalRoles(orderedBlocks: PlacedBlock[], startPageCount: number): PlannedPage[] {
        if (orderedBlocks.length === 0) {
            return [this.createEmptyPage(1, 'single')];
        }

        const maxPages = orderedBlocks.length + 1;
        for (let targetPages = Math.max(2, startPageCount); targetPages <= maxPages; targetPages += 1) {
            const pages: PlannedPage[] = [];
            let blockIndex = 0;
            let failed = false;

            for (let pageIndex = 0; pageIndex < targetPages && blockIndex < orderedBlocks.length; pageIndex += 1) {
                const role: PageRole = pageIndex === 0 ? 'first' : (pageIndex === targetPages - 1 ? 'last' : 'middle');
                const page = this.createEmptyPage(pageIndex + 1, role);
                pages.push(page);

                while (blockIndex < orderedBlocks.length) {
                    const candidate = orderedBlocks[blockIndex];
                    const gap = page.blocks.length > 0 ? this.template.blockGapMm : 0;
                    const remaining = page.bodyCapacityMm - page.usedBodyMm - gap;

                    if (candidate.heightMm <= remaining + EPSILON) {
                        page.blocks.push({ ...candidate });
                        page.usedBodyMm = sumHeights(page.blocks, this.template.blockGapMm);
                        page.freeBodyMm = page.bodyCapacityMm - page.usedBodyMm;
                        blockIndex += 1;
                        continue;
                    }
                    break;
                }

                if (page.blocks.length === 0) {
                    failed = true;
                    break;
                }
            }

            if (failed) continue;
            if (blockIndex < orderedBlocks.length) continue;

            return pages.map((page, idx) => {
                const role: PageRole = idx === 0 ? 'first' : (idx === pages.length - 1 ? 'last' : 'middle');
                const capacity = this.bodyCapacityForRole(role);
                const used = sumHeights(page.blocks, this.template.blockGapMm);
                return {
                    ...page,
                    role,
                    showHeader: this.showHeaderForRole(role),
                    showFooter: this.showFooterForRole(role),
                    footerExceptionApplied: false,
                    bodyCapacityMm: capacity,
                    usedBodyMm: used,
                    freeBodyMm: capacity - used,
                };
            });
        }

        throw new Error('Unable to repack blocks into valid first/middle/last page capacities');
    }

    private tryPlaceBlock(page: PlannedPage, block: ContentBlock): boolean {
        const gap = page.blocks.length > 0 ? this.template.blockGapMm : 0;
        const remaining = page.bodyCapacityMm - page.usedBodyMm - gap;
        if (remaining <= EPSILON) return false;

        if (block.heightMm <= remaining + EPSILON) {
            page.blocks.push(buildPlaced(block, block.heightMm, 0, false));
            page.usedBodyMm = sumHeights(page.blocks, this.template.blockGapMm);
            page.freeBodyMm = page.bodyCapacityMm - page.usedBodyMm;
            return true;
        }

        // Split behavior is intentionally disabled in this baseline engine:
        // block splitting should be implemented per content type (paragraphs/tables/etc.)
        // so readability rules can be preserved.
        return false;
    }

    private bodyCapacityForRole(role: PageRole): number {
        const printableHeight = this.template.page.height - this.template.margins.top - this.template.margins.bottom;
        const header = this.showHeaderForRole(role) ? this.template.headerHeightMm : 0;
        const footer = this.showFooterForRole(role) ? this.template.footerHeightMm : 0;
        const safety = this.template.bottomSafetyMm ?? 0;
        return printableHeight - header - footer - safety;
    }

    private bodyCapacityForSingle(showFooter: boolean): number {
        const printableHeight = this.template.page.height - this.template.margins.top - this.template.margins.bottom;
        const header = this.showHeaderForRole('single') ? this.template.headerHeightMm : 0;
        const footer = showFooter ? this.template.footerHeightMm : 0;
        const safety = this.template.bottomSafetyMm ?? 0;
        return printableHeight - header - footer - safety;
    }

    private showHeaderForRole(role: PageRole): boolean {
        const mode = this.template.headerVisibility ?? 'first-and-single';
        if (mode === 'none') return false;
        if (mode === 'every-page') return true;
        return role === 'single' || role === 'first';
    }

    private showFooterForRole(role: PageRole): boolean {
        const mode = this.template.footerVisibility ?? 'last-and-single';
        if (mode === 'none') return false;
        if (mode === 'every-page') return true;
        return role === 'single' || role === 'last';
    }

    private expectedHeaderForPosition(pageIndex: number, totalPages: number): boolean {
        const mode = this.template.headerVisibility ?? 'first-and-single';
        if (mode === 'none') return false;
        if (mode === 'every-page') return true;
        return totalPages === 1 || pageIndex === 0;
    }

    private expectedFooterForPosition(pageIndex: number, totalPages: number, page?: PlannedPage): boolean {
        const mode = this.template.footerVisibility ?? 'last-and-single';
        if (mode === 'none') return false;
        if (mode === 'every-page') return true;
        if (totalPages === 1) {
            if (page && this.canUseSinglePageFooterException(page.usedBodyMm)) return false;
            return true;
        }
        return pageIndex === totalPages - 1;
    }

    private canUseSinglePageFooterException(usedMm: number): boolean {
        if (!this.showFooterForRole('single')) return false;
        const withFooter = this.bodyCapacityForSingle(true);
        const withoutFooter = this.bodyCapacityForSingle(false);
        return usedMm > withFooter + EPSILON && usedMm <= withoutFooter + EPSILON;
    }

    private buildSinglePage(blocks: PlacedBlock[], showFooter: boolean): PlannedPage {
        const bodyCapacityMm = this.bodyCapacityForSingle(showFooter);
        const usedBodyMm = sumHeights(blocks, this.template.blockGapMm);
        return {
            pageNumber: 1,
            role: 'single',
            showHeader: this.showHeaderForRole('single'),
            showFooter,
            footerExceptionApplied: !showFooter,
            bodyCapacityMm,
            usedBodyMm,
            freeBodyMm: bodyCapacityMm - usedBodyMm,
            blocks: [...blocks],
        };
    }

    private debug(message: string, details?: Record<string, unknown>): void {
        if (!PDF_LAYOUT_DEBUG) return;
        if (details) {
            console.debug(`[pdf-layout] ${message}`, details);
            return;
        }
        console.debug(`[pdf-layout] ${message}`);
    }
}

export const DEFAULT_A4_TEMPLATE: PdfLayoutTemplate = {
    page: { width: 210, height: 297 },
    margins: { top: 5, right: 5, bottom: 5, left: 5 },
    headerHeightMm: 52,
    footerHeightMm: 20,
    blockGapMm: 2.5,
    bottomSafetyMm: 2,
};

export const DEFAULT_RENDER_CANDIDATES: RenderCandidate[] = [
    {
        key: 'html2canvas-jspdf',
        description: 'Fast retrofit for DOM-based templates; image-based PDF output.',
        searchableText: 2,
        visualFidelity: 9,
        performance: 6,
        implementationSpeed: 9,
    },
    {
        key: 'react-pdf',
        description: 'Component-based PDF layout with predictable pagination; selectable text.',
        searchableText: 9,
        visualFidelity: 7,
        performance: 8,
        implementationSpeed: 6,
    },
    {
        key: 'pdf-lib',
        description: 'Low-level drawing engine; strongest control and compact output for custom templates.',
        searchableText: 10,
        visualFidelity: 8,
        performance: 9,
        implementationSpeed: 4,
    },
];
