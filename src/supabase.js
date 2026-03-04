import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://motblfivpjlhnjneuymb.supabase.co'
const supabaseKey = 'sb_publishable_po3q1ScCMMUtw-ElA8Vl5g_CiweoiEP'

export const supabase = createClient(supabaseUrl, supabaseKey)
