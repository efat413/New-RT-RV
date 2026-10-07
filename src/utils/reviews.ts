import { ProductReview, ReviewStatus } from '../types';

export interface ReviewStats {
  totalReviews: number;
  averageRating: number;
  distribution: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
  distributionPercentages: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
}

/**
 * Calculates dynamic review statistics strictly from approved reviews.
 * Never stores static rating values inside the product table.
 */
export function computeProductReviewStats(
  reviews: ProductReview[],
  fallbackRating = 5.0,
  fallbackReviewsCount = 0
): ReviewStats {
  // Only approved reviews count towards public ratings
  const approved = (reviews || []).filter(
    (r) => !r.status || r.status === 'approved'
  );

  if (approved.length === 0) {
    const hasFallback = fallbackReviewsCount > 0;
    return {
      totalReviews: fallbackReviewsCount,
      averageRating: hasFallback ? Number(fallbackRating.toFixed(1)) : 5.0,
      distribution: {
        5: hasFallback ? fallbackReviewsCount : 0,
        4: 0,
        3: 0,
        2: 0,
        1: 0,
      },
      distributionPercentages: {
        5: hasFallback ? 100 : 0,
        4: 0,
        3: 0,
        2: 0,
        1: 0,
      },
    };
  }

  const dist: Record<1 | 2 | 3 | 4 | 5, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sum = 0;

  for (const r of approved) {
    const star = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5))) as 1 | 2 | 3 | 4 | 5;
    dist[star] = (dist[star] || 0) + 1;
    sum += Number(r.rating) || 5;
  }

  const total = approved.length;
  const avg = Number((sum / total).toFixed(1));

  const percentages = {
    5: Math.round(((dist[5] || 0) / total) * 100),
    4: Math.round(((dist[4] || 0) / total) * 100),
    3: Math.round(((dist[3] || 0) / total) * 100),
    2: Math.round(((dist[2] || 0) / total) * 100),
    1: Math.round(((dist[1] || 0) / total) * 100),
  };

  return {
    totalReviews: total,
    averageRating: avg,
    distribution: dist,
    distributionPercentages: percentages,
  };
}

/**
 * Robust XSS and HTML injection sanitizer for user-submitted review fields.
 * Strips script tags, HTML tags, and escapes dangerous entities.
 */
export function sanitizeReviewText(input: string): string {
  if (!input) return '';
  return input
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .replace(/[<>'"&]/g, (char) => {
      switch (char) {
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '&':
          return '&amp;';
        case '"':
          return '&quot;';
        case "'":
          return '&#x27;';
        default:
          return char;
      }
    })
    .trim();
}

/**
 * Sorts reviews according to ecommerce standard sort strategies:
 * - newest: Newest First
 * - oldest: Oldest First
 * - highest: Highest Rating
 * - lowest: Lowest Rating
 * - photos: Reviews with Photos First
 */
export function sortReviews(
  reviews: ProductReview[],
  sortBy: 'newest' | 'oldest' | 'highest' | 'lowest' | 'photos' | string
): ProductReview[] {
  const list = [...reviews];
  return list.sort((a, b) => {
    if (sortBy === 'photos') {
      const aHas = (a.images && a.images.length > 0) ? 1 : 0;
      const bHas = (b.images && b.images.length > 0) ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
    }
    if (sortBy === 'highest') {
      if (b.rating !== a.rating) return b.rating - a.rating;
    }
    if (sortBy === 'lowest') {
      if (a.rating !== b.rating) return a.rating - b.rating;
    }
    if (sortBy === 'oldest') {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeA - timeB;
    }
    // Default: 'newest'
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });
}
