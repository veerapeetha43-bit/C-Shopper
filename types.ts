
export interface Store {
  id: string;
  name: string;
  address: string;
  zipCode: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  distance?: number;
  gasPrices?: {
    regular: number;
    premium: number;
    updatedAt: string;
  };
}

export interface ReceiptItem {
  id: string;
  itemNumber: string;
  name: string;
  price: number;
  category: string;
  purchaseDate: string;
  warehouseId?: string; // store selected when scanned (set for new scans)
}

export interface GlobalPriceEntry {
  itemNumber: string;
  itemName: string;
  price: number;
  unitPrice?: number; // e.g., 0.05
  unit?: string; // e.g., "oz"
  warehouseId: string;
  zipCode: string;
  updatedAt: string;
  isDiscontinued?: boolean; // The "Death Star" asterisk
  stockStatus?: 'high' | 'low' | 'out_of_stock';
  category?: string;
}

export type PlanTier = 'silver' | 'gold' | 'platinum';

export interface BillingInfo {
  cardNumber: string;
  expiry: string;
  cvv: string;
  zip: string;
}

export interface UserSubscription {
  type: PlanTier;
  isTrial: boolean;
  trialStartDate: string; // ISO format
  receiptsCount: number;
  members: string[]; // List of invited emails/phones
  billingInfo?: BillingInfo;
  status: 'active' | 'cancelled' | 'trial';
}

export interface UserProfile {
  id: string;
  emailOrPhone: string;
  userName: string;
  avatar: string;
  subscription: UserSubscription;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  text: string;
  timestamp: string;
  channelId: string;
  type: 'price' | 'availability' | 'review' | 'general';
  itemNumber?: string;
  imageUrl?: string;
}

export interface CommunityGroup {
  id: string;
  name: string;
  description: string;
  creatorId: string;
  members: string[]; // userIds
  pendingRequests: string[]; // userIds
  isPublic: boolean;
  storeId?: string; // warehouse id this hub belongs to; undefined = general
  keywords: string[];
  creatorEmail?: string; // login email of the creator; used to keep private groups private across shared-device logins
}

export interface GroupComment {
  id: string;
  groupId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  text: string;
  rating?: number;
  itemNumber?: string; // Optional: linked to a specific item
  itemName?: string;
  timestamp: string;
  imageUrl?: string; // Support for photos in chat
  reported?: boolean; // flagged via the Report action in chat
  reportedBy?: string; // userId of the reporter
}

export interface ItemReview {
  id: string;
  userId: string;
  userName: string;
  warehouseId: string;
  itemNumber: string;
  itemName: string;
  rating: number;
  text: string;
  imageUrl?: string;
  timestamp: string;
}

export interface SharedListItem {
  id: string;
  itemNumber?: string;
  title: string;
  notes?: string;
  qty: number;
  status: 'pending' | 'approved' | 'declined';
  approvedBy?: string; 
  visibleTo: 'everyone' | 'admins_only'; 
  votes: { yes: string[]; no: string[] }; // Arrays of userIds
  createdBy: string;
  price?: number;
}

export interface CartItem {
  id: string;
  title: string;
  qty: number;
  state: 'needed' | 'in_cart' | 'bought' | 'out_of_stock';
  itemNumber?: string;
}

export interface AppNotification {
  id: string;
  msg: string;
  type: 'success' | 'alert';
}

/** Public-share outbox entry: user-confirmed, PII-stripped items queued for
 *  the community price database. Flushed by services/cloud.ts once Supabase
 *  is configured. Raw receipt text/images are never stored here. */
export interface ShareOutboxEntry {
  id: string;
  sharedAt: string; // ISO timestamp
  items: {
    itemNumber: string;
    name: string;
    price: number;
    category: string;
    purchaseDate: string;
  }[];
}
