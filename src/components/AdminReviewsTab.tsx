import React, { useState, useMemo } from 'react';
import {
  Star,
  CheckCircle2,
  XCircle,
  EyeOff,
  Eye,
  Trash2,
  Plus,
  Search,
  Filter,
  Check,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Images,
  ExternalLink,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { Product, ProductReview, ReviewStatus } from '../types';
import { useStore } from '../context/StoreContext';
import { ConfirmModal } from './ConfirmModal';
import { computeProductReviewStats } from '../utils/reviews';

interface AdminReviewsTabProps {
  products: Product[];
  reviews: ProductReview[];
  onApproveReview: (id: string) => Promise<any>;
  onRejectReview: (id: string) => Promise<any>;
  onHideReview: (id: string) => Promise<any>;
  onDeleteReview: (id: string) => Promise<any>;
  onCreateManualReview: (review: Partial<ProductReview>) => Promise<any>;
  filterProductId?: string | null;
  onClearProductFilter?: () => void;
}

export const AdminReviewsTab: React.FC<AdminReviewsTabProps> = ({
  products,
  reviews,
  onApproveReview,
  onRejectReview,
  onHideReview,
  onDeleteReview,
  onCreateManualReview,
  filterProductId,
  onClearProductFilter,
}) => {
  const { showNotification } = useStore();

  // Filters & Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewStatus>('all');
  const [ratingFilter, setRatingFilter] = useState<number | 'all'>('all');
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>(filterProductId || 'all');

  // Pagination State (bounded display)
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    isOpen: boolean;
    reviewId: string;
    authorName: string;
  }>({
    isOpen: false,
    reviewId: '',
    authorName: '',
  });

  // Manual Review Form State
  const [formProductId, setFormProductId] = useState<string>(products[0]?.id || '');
  const [formAuthorName, setFormAuthorName] = useState('');
  const [formRating, setFormRating] = useState<number>(5);
  const [formComment, setFormComment] = useState('');
  const [formDate, setFormDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [formVerified, setFormVerified] = useState<boolean>(true);
  const [formStatus, setFormStatus] = useState<ReviewStatus>('approved');
  const [formImages, setFormImages] = useState<string[]>([]);
  const [newImageInput, setNewImageInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Sync prop filter changes
  React.useEffect(() => {
    if (filterProductId) {
      setSelectedProductId(filterProductId);
    }
  }, [filterProductId]);

  // Overall Metrics Calculation
  const metrics = useMemo(() => {
    const total = reviews.length;
    const pending = reviews.filter((r) => r.status === 'pending').length;
    const approved = reviews.filter((r) => !r.status || r.status === 'approved').length;
    const rejected = reviews.filter((r) => r.status === 'rejected').length;
    const hidden = reviews.filter((r) => r.status === 'hidden').length;
    const verified = reviews.filter((r) => r.verifiedPurchase).length;

    const approvedReviews = reviews.filter((r) => !r.status || r.status === 'approved');
    const avgScore =
      approvedReviews.length > 0
        ? (approvedReviews.reduce((sum, r) => sum + (Number(r.rating) || 5), 0) / approvedReviews.length).toFixed(1)
        : '5.0';

    const verifiedPercent = total > 0 ? Math.round((verified / total) * 100) : 0;

    return {
      total,
      pending,
      approved,
      rejected,
      hidden,
      avgScore,
      verifiedPercent,
    };
  }, [reviews]);

  // Filtered Reviews List
  const filteredReviews = useMemo(() => {
    return reviews.filter((rev) => {
      // 1. Status Filter
      if (statusFilter !== 'all') {
        const revStatus = rev.status || 'approved';
        if (revStatus !== statusFilter) return false;
      }

      // 2. Product Filter
      if (selectedProductId !== 'all') {
        if (rev.productId !== selectedProductId) return false;
      }

      // 3. Rating Filter
      if (ratingFilter !== 'all') {
        if (Math.round(Number(rev.rating)) !== ratingFilter) return false;
      }

      // 4. Verified Purchase Filter
      if (verifiedFilter === 'verified' && !rev.verifiedPurchase) return false;
      if (verifiedFilter === 'unverified' && rev.verifiedPurchase) return false;

      // 5. Search Query (author, comment, product title)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const author = (rev.authorName || rev.author || '').toLowerCase();
        const comment = (rev.comment || '').toLowerCase();
        const targetProd = products.find((p) => p.id === rev.productId);
        const prodTitle = (targetProd?.title || '').toLowerCase();

        const matches =
          author.includes(query) ||
          comment.includes(query) ||
          prodTitle.includes(query);
        if (!matches) return false;
      }

      return true;
    });
  }, [reviews, statusFilter, selectedProductId, ratingFilter, verifiedFilter, searchQuery, products]);

  // Reset page when filter criteria change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, selectedProductId, ratingFilter, verifiedFilter, searchQuery, pageSize]);

  // Pagination bounds & slice
  const totalItems = filteredReviews.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedReviews = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return filteredReviews.slice(startIndex, startIndex + pageSize);
  }, [filteredReviews, safeCurrentPage, pageSize]);

  // Product helper lookup
  const getProduct = (productId: string) => {
    return products.find((p) => p.id === productId || p.slug === productId);
  };

  // Manual Review Submission
  const handleCreateReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProductId) {
      setFormError('Please select a target product.');
      return;
    }
    if (!formAuthorName.trim()) {
      setFormError('Please enter a customer name.');
      return;
    }
    if (!formComment.trim()) {
      setFormError('Please enter a review comment.');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);

    try {
      await onCreateManualReview({
        productId: formProductId,
        authorName: formAuthorName.trim(),
        author: formAuthorName.trim(),
        rating: formRating,
        comment: formComment.trim(),
        createdAt: formDate ? new Date(formDate).toISOString() : new Date().toISOString(),
        verifiedPurchase: formVerified,
        status: formStatus,
        images: formImages,
      });

      setIsCreateModalOpen(false);
      // Reset form
      setFormAuthorName('');
      setFormComment('');
      setFormRating(5);
      setFormVerified(true);
      setFormStatus('approved');
      setFormImages([]);
      setNewImageInput('');
    } catch (err: any) {
      setFormError(err.message || 'Failed to create manual review.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddImageToForm = () => {
    if (!newImageInput.trim()) return;
    if (formImages.length >= 5) {
      showNotification('warning', 'Limit Reached', 'You can attach up to 5 photos per review.');
      return;
    }
    setFormImages((prev) => [...prev, newImageInput.trim()]);
    setNewImageInput('');
  };

  const handleRemoveImageFromForm = (idx: number) => {
    setFormImages((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            </div>
            <h1 className="text-lg sm:text-xl font-display font-extrabold text-white">
              Customer Reviews Moderation
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Moderate storefront feedback, approve verified buyer testimonials, and add manual reviews.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormProductId(selectedProductId !== 'all' ? selectedProductId : products[0]?.id || '');
            setIsCreateModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Manual Review</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Total Reviews */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-1">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Reviews</p>
          <p className="text-2xl font-display font-extrabold text-slate-900">{metrics.total}</p>
          <p className="text-[10px] text-slate-400">All customer submissions</p>
        </div>

        {/* Pending Moderation */}
        <div
          onClick={() => setStatusFilter('pending')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            metrics.pending > 0
              ? 'bg-amber-50/60 border-amber-300 shadow-sm'
              : 'bg-white border-slate-200/80 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">Pending</p>
            {metrics.pending > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            )}
          </div>
          <p className="text-2xl font-display font-extrabold text-amber-700">{metrics.pending}</p>
          <p className="text-[10px] text-amber-600 font-medium">Requires admin approval</p>
        </div>

        {/* Approved Reviews */}
        <div
          onClick={() => setStatusFilter('approved')}
          className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-1 cursor-pointer hover:border-emerald-300 transition-colors"
        >
          <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Approved</p>
          <p className="text-2xl font-display font-extrabold text-emerald-600">{metrics.approved}</p>
          <p className="text-[10px] text-slate-400">Publicly visible on storefront</p>
        </div>

        {/* Average Store Rating */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Avg Store Score</p>
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
          </div>
          <p className="text-2xl font-display font-extrabold text-slate-900">
            {metrics.avgScore} <span className="text-xs font-normal text-slate-400">/ 5.0</span>
          </p>
          <p className="text-[10px] text-slate-400">Calculated from approved</p>
        </div>

        {/* Verified Purchases */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-1 col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Verified Buyers</p>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <p className="text-2xl font-display font-extrabold text-emerald-700">{metrics.verifiedPercent}%</p>
          <p className="text-[10px] text-slate-400">Order history confirmed</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3">
        {/* Row 1: Search and Product dropdown */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Search Input */}
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, comment, or product..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Product Filter */}
          <div className="md:col-span-4">
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none font-medium"
            >
              <option value="all">All Products ({products.length})</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          {/* Rating Filter */}
          <div className="md:col-span-3">
            <select
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none font-medium"
            >
              <option value="all">All Star Ratings</option>
              <option value="5">★★★★★ 5 Stars Only</option>
              <option value="4">★★★★☆ 4 Stars Only</option>
              <option value="3">★★★☆☆ 3 Stars Only</option>
              <option value="2">★★☆☆☆ 2 Stars Only</option>
              <option value="1">★☆☆☆☆ 1 Star Only</option>
            </select>
          </div>
        </div>

        {/* Row 2: Status Tabs and Verified Filter */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: 'All Reviews', count: metrics.total },
              { id: 'pending', label: 'Pending', count: metrics.pending, alert: metrics.pending > 0 },
              { id: 'approved', label: 'Approved', count: metrics.approved },
              { id: 'rejected', label: 'Rejected', count: metrics.rejected },
              { id: 'hidden', label: 'Hidden', count: metrics.hidden },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  statusFilter === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    tab.alert
                      ? 'bg-amber-500 text-white font-extrabold'
                      : statusFilter === tab.id
                      ? 'bg-slate-800 text-slate-200'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Verified Toggle Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400">Buyer:</span>
            <select
              value={verifiedFilter}
              onChange={(e) => setVerifiedFilter(e.target.value as any)}
              className="px-2.5 py-1 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none font-medium"
            >
              <option value="all">All Buyers</option>
              <option value="verified">Verified Only</option>
              <option value="unverified">Unverified Only</option>
            </select>
          </div>
        </div>

        {/* Filter reset indicator */}
        {(selectedProductId !== 'all' || searchQuery || statusFilter !== 'all' || ratingFilter !== 'all' || verifiedFilter !== 'all') && (
          <div className="pt-1 flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing <strong className="text-slate-800">{filteredReviews.length}</strong> of {reviews.length} reviews
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedProductId('all');
                setSearchQuery('');
                setStatusFilter('all');
                setRatingFilter('all');
                setVerifiedFilter('all');
                if (onClearProductFilter) onClearProductFilter();
              }}
              className="text-amber-600 hover:text-amber-700 font-bold hover:underline"
            >
              Reset All Filters
            </button>
          </div>
        )}
      </div>

      {/* Reviews List Cards */}
      <div className="space-y-3">
        {filteredReviews.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center space-y-3 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-800 text-sm">No reviews found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              There are no customer reviews matching your current filter criteria.
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedProductId('all');
                setStatusFilter('all');
                setRatingFilter('all');
                setVerifiedFilter('all');
                setSearchQuery('');
              }}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
            >
              Clear Filters
            </button>
          </div>
        ) : (
          paginatedReviews.map((rev) => {
            const product = getProduct(rev.productId);
            const currentStatus = rev.status || 'approved';

            return (
              <div
                key={rev.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md transition-all space-y-3"
              >
                {/* Header row: Author + Product + Status badge */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  {/* Left: Author Info */}
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-bold text-sm shrink-0">
                      {rev.authorName ? rev.authorName.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                          {rev.authorName || rev.author || 'Store Customer'}
                        </h4>

                        {/* Verified Purchase Badge */}
                        {rev.verifiedPurchase ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Verified Purchase
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            Unverified
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-400">
                        {rev.createdAt ? new Date(rev.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                      </p>
                    </div>
                  </div>

                  {/* Right: Target Product & Status Badge */}
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    {/* Status Badge */}
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-1 ${
                        currentStatus === 'approved'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : currentStatus === 'pending'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
                          : currentStatus === 'rejected'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {currentStatus === 'approved' && <Check className="w-3 h-3" />}
                      {currentStatus === 'pending' && <Clock className="w-3 h-3" />}
                      {currentStatus === 'rejected' && <XCircle className="w-3 h-3" />}
                      {currentStatus === 'hidden' && <EyeOff className="w-3 h-3" />}
                      <span>{currentStatus}</span>
                    </span>
                  </div>
                </div>

                {/* Target Product snippet */}
                {product && (
                  <div className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/60 flex items-center justify-between text-xs gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={product.imageUrl}
                        alt={product.title}
                        className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 truncate text-xs">{product.title}</p>
                        <p className="text-[10px] text-slate-500 font-mono">৳{product.price.toLocaleString()}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedProductId(product.id)}
                      className="text-[11px] font-bold text-amber-700 hover:text-amber-800 shrink-0 hover:underline"
                    >
                      Filter this product
                    </button>
                  </div>
                )}

                {/* Star rating & Comment */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((starIdx) => (
                      <Star
                        key={starIdx}
                        className={`w-4 h-4 ${
                          starIdx <= Math.round(rev.rating)
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-200'
                        }`}
                      />
                    ))}
                    <span className="text-xs font-extrabold text-slate-800 ml-1 font-mono">
                      {Number(rev.rating).toFixed(1)}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-normal">
                    {rev.comment}
                  </p>
                </div>

                {/* Review Photos thumbnail gallery */}
                {rev.images && rev.images.length > 0 && (
                  <div className="pt-1">
                    <p className="text-[10px] font-bold text-slate-400 mb-1.5 flex items-center gap-1 uppercase tracking-wider">
                      <Images className="w-3 h-3" />
                      <span>Customer Photos ({rev.images.length})</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {rev.images.map((imgUrl, imgIdx) => (
                        <button
                          key={imgIdx}
                          type="button"
                          onClick={() => setPreviewImageUrl(imgUrl)}
                          className="relative w-14 h-14 rounded-xl overflow-hidden border border-slate-200 hover:border-amber-500 transition-all cursor-pointer group"
                        >
                          <img
                            src={imgUrl}
                            alt={`Review photo ${imgIdx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Controls Toolbar */}
                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  {/* Left: Quick Moderation Buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Approve button */}
                    {currentStatus !== 'approved' && (
                      <button
                        type="button"
                        onClick={() => onApproveReview(rev.id)}
                        className="px-3 py-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center gap-1 border border-emerald-200 transition-all cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Approve</span>
                      </button>
                    )}

                    {/* Reject button */}
                    {currentStatus !== 'rejected' && (
                      <button
                        type="button"
                        onClick={() => onRejectReview(rev.id)}
                        className="px-3 py-1 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold text-xs flex items-center gap-1 border border-rose-200 transition-all cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5 text-rose-600" />
                        <span>Reject</span>
                      </button>
                    )}

                    {/* Hide button */}
                    {currentStatus !== 'hidden' && (
                      <button
                        type="button"
                        onClick={() => onHideReview(rev.id)}
                        className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1 border border-slate-200 transition-all cursor-pointer"
                      >
                        <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                        <span>Hide</span>
                      </button>
                    )}
                  </div>

                  {/* Right: Delete button */}
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteConfirmDialog({
                        isOpen: true,
                        reviewId: rev.id,
                        authorName: rev.authorName || rev.author || 'Shopper',
                      })
                    }
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                    title="Permanently Delete Review"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}

        {/* Pagination Bar */}
        {totalItems > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-3.5 sm:p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2 font-medium">
              <span>
                Showing <strong className="text-slate-900 font-bold">{(safeCurrentPage - 1) * pageSize + 1}</strong> - <strong className="text-slate-900 font-bold">{Math.min(safeCurrentPage * pageSize, totalItems)}</strong> of <strong className="text-slate-900 font-bold">{totalItems}</strong> reviews
              </span>
              <span className="text-slate-300">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="px-2 py-0.5 rounded-lg border border-slate-200 bg-white font-bold text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safeCurrentPage <= 1}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white text-slate-700 font-bold flex items-center gap-1 transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev</span>
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, idx) => idx + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1)
                    .map((p, idx, arr) => {
                      const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
                      return (
                        <React.Fragment key={p}>
                          {showEllipsis && <span className="px-1 text-slate-300">...</span>}
                          <button
                            type="button"
                            onClick={() => setCurrentPage(p)}
                            className={`min-w-7 h-7 rounded-xl font-bold transition-all cursor-pointer ${
                              safeCurrentPage === p
                                ? 'bg-slate-900 text-white shadow-xs'
                                : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            {p}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safeCurrentPage >= totalPages}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white text-slate-700 font-bold flex items-center gap-1 transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* MODAL: MANUAL REVIEW CREATION (Phase 5)                       */}
      {/* ============================================================ */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
            {/* Top rainbow gradient accent bar */}
            <div className="h-2 w-full rainbow-gradient-bg" />

            <form onSubmit={handleCreateReviewSubmit} className="p-6 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-display font-extrabold text-slate-900 text-base">
                    Add Existing Customer Review
                  </h3>
                  <p className="text-xs text-slate-400">
                    Manually add offline or existing customer feedback to the product page.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Product Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Target Product <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formProductId}
                  onChange={(e) => setFormProductId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} (৳{p.price})
                    </option>
                  ))}
                </select>
              </div>

              {/* Customer Name and Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Customer Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formAuthorName}
                    onChange={(e) => setFormAuthorName(e.target.value)}
                    required
                    placeholder="e.g. Shakib Al Hasan"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Review Date
                  </label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
                  />
                </div>
              </div>

              {/* Star Rating Picker */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Rating (1 to 5 Stars) <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setFormRating(star)}
                      className="p-1 hover:scale-110 transition-transform cursor-pointer"
                    >
                      <Star
                        className={`w-6 h-6 ${
                          star <= formRating
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-300'
                        }`}
                      />
                    </button>
                  ))}
                  <span className="ml-2 font-bold text-slate-800 text-xs font-mono">
                    {formRating} Star{formRating > 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Review Comment */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Review Comment <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={formComment}
                  onChange={(e) => setFormComment(e.target.value)}
                  rows={3}
                  required
                  placeholder="Share customer's genuine feedback and feedback quotes..."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
                />
              </div>

              {/* Verified Purchase & Moderation Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formVerified}
                    onChange={(e) => setFormVerified(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Verified Purchase</span>
                    <span className="text-[10px] text-slate-500">Show verified badge</span>
                  </div>
                </label>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Publish Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full px-2.5 py-1 text-xs rounded-lg border border-slate-300 bg-white font-medium focus:outline-none"
                  >
                    <option value="approved">Approved (Live)</option>
                    <option value="pending">Pending</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </div>
              </div>

              {/* Review Photos (Optional) */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  Optional Photos (Image URLs)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={newImageInput}
                    onChange={(e) => setNewImageInput(e.target.value)}
                    placeholder="https://images.unsplash.com/photo-..."
                    className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-300 focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddImageToForm}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-black transition-colors"
                  >
                    Add
                  </button>
                </div>

                {formImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {formImages.map((img, i) => (
                      <div key={i} className="relative w-12 h-12 rounded-lg border border-slate-200 overflow-hidden group">
                        <img src={img} alt="preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleRemoveImageFromForm(i)}
                          className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Modal Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 font-bold text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Add Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Preview Lightbox */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200 cursor-pointer"
        >
          <div className="relative max-w-2xl max-h-[85vh]">
            <img
              src={previewImageUrl}
              alt="Enlarged review photo"
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setPreviewImageUrl(null)}
              className="absolute top-2 right-2 p-2 rounded-full bg-black/70 text-white hover:bg-black transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirmDialog.isOpen}
        title="Delete Customer Review"
        message={`Are you sure you want to permanently delete this customer review by "${deleteConfirmDialog.authorName}"? This action cannot be undone.`}
        confirmText="Delete Review"
        variant="danger"
        onConfirm={async () => {
          await onDeleteReview(deleteConfirmDialog.reviewId);
          setDeleteConfirmDialog({ isOpen: false, reviewId: '', authorName: '' });
        }}
        onClose={() =>
          setDeleteConfirmDialog({ isOpen: false, reviewId: '', authorName: '' })
        }
      />
    </div>
  );
};
