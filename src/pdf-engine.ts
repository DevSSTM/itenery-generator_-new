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
}

export interface ContentBlock {
    id: string;
    heightMm: number;
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
        const sanitizedBlocks = blocks.filter((b) => b.heightMm > 0);
        if (sanitizedBlocks.length === 0) {
            const page = this.createEmptyPage(1, 'single');
            return this.validate({ pages: [page], errors: [], valid: true });
        }

        let pages = this.packAsFirstMiddle(sanitizedBlocks);
        pages = this.adjustForLastFooter(pages);
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

            const expectedHeader = plan.pages.length === 1 ? true : index === 0;
            const expectedFooter = plan.pages.length === 1 ? true : index === plan.pages.length - 1;
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
            showHeader: role === 'single' || role === 'first',
            showFooter: role === 'single' || role === 'last',
            bodyCapacityMm: bodyCapacity,
        });
    }

    private packAsFirstMiddle(blocks: ContentBlock[]): PlannedPage[] {
        const pages: PlannedPage[] = [];
        let page = this.createEmptyPage(1, 'first');
        pages.push(page);

        for (const block of blocks) {
            page = pages[pages.length - 1];
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

    private adjustForLastFooter(pages: PlannedPage[]): PlannedPage[] {
        if (pages.length === 1) {
            const single = this.createEmptyPage(1, 'single');
            const blocks = [...pages[0].blocks];
            const packed = this.repackBlocksIntoPages(blocks, ['single']);
            return packed.length > 0 ? packed : [single];
        }

        const allBlocks = pages.flatMap((p) => p.blocks);
        return this.repackBlocksIntoPages(allBlocks, ['first', 'middle', 'last']);
    }

    private repackBlocksIntoPages(blocks: PlacedBlock[], roles: ('single' | 'first' | 'middle' | 'last')[]): PlannedPage[] {
        const sourceBlocks: ContentBlock[] = blocks.map((b) => ({
            id: b.sourceId,
            heightMm: b.heightMm,
            keepTogether: !b.isSplitPart,
            splittable: b.isSplitPart,
            payload: b.payload,
        }));

        const pages: PlannedPage[] = [];
        let i = 0;
        while (i < sourceBlocks.length) {
            const pageIndex = pages.length;
            const role = this.roleForIndex(pageIndex, sourceBlocks.length, i, pages.length, roles);
            const page = this.createEmptyPage(pageIndex + 1, role);
            pages.push(page);

            while (i < sourceBlocks.length && this.tryPlaceBlock(page, sourceBlocks[i])) {
                i += 1;
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
            single.role = 'single';
            single.showHeader = true;
            single.showFooter = true;
            single.bodyCapacityMm = this.bodyCapacityForRole('single');
            single.usedBodyMm = sumHeights(single.blocks, this.template.blockGapMm);
            single.freeBodyMm = single.bodyCapacityMm - single.usedBodyMm;
            return pages;
        }

        return pages.map((page, idx) => {
            const role: PageRole = idx === 0 ? 'first' : (idx === pages.length - 1 ? 'last' : 'middle');
            const capacity = this.bodyCapacityForRole(role);
            const used = sumHeights(page.blocks, this.template.blockGapMm);
            return {
                ...page,
                role,
                showHeader: idx === 0,
                showFooter: idx === pages.length - 1,
                bodyCapacityMm: capacity,
                usedBodyMm: used,
                freeBodyMm: capacity - used,
            };
        });
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
        const header = role === 'single' || role === 'first' ? this.template.headerHeightMm : 0;
        const footer = role === 'single' || role === 'last' ? this.template.footerHeightMm : 0;
        return printableHeight - header - footer;
    }
}

export const DEFAULT_A4_TEMPLATE: PdfLayoutTemplate = {
    page: { width: 210, height: 297 },
    margins: { top: 5, right: 5, bottom: 5, left: 5 },
    headerHeightMm: 52,
    footerHeightMm: 20,
    blockGapMm: 2.5,
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
