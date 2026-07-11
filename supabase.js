// --------------------------------------------
// Supabase Realtime Controller
// --------------------------------------------

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// --------------------------------------------
// YOUR PROJECT
// --------------------------------------------

const SUPABASE_URL =
"https://nzdvchpqyjratjehihld.supabase.co";

const SUPABASE_KEY =
"sb_publishable_4Mk6edtpcZHKDDhozciqkw_4NhifvKo";

// --------------------------------------------

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

// --------------------------------------------
// Current model cache
// --------------------------------------------

let currentModel = null;

// --------------------------------------------
// Load current model on startup
// --------------------------------------------

async function loadCurrentModel() {

    const { data, error } = await supabase

        .from("display_state")

        .select("current_model")

        .eq("id",1)

        .single();

    if(error){

        console.error(error);

        return;

    }

    currentModel = data.current_model;

    console.log("Initial Model:",currentModel);

    if(window.loadModel){

        window.loadModel(currentModel);

    }

}

loadCurrentModel();

// --------------------------------------------
// Listen for realtime changes
// --------------------------------------------

supabase

.channel("display-channel")

.on(

"postgres_changes",

{

event:"UPDATE",

schema:"public",

table:"display_state"

},

(payload)=>{

    const newModel = payload.new.current_model;

    console.log("Realtime:",newModel);

    if(newModel===currentModel) return;

    currentModel=newModel;

    if(window.loadModel){

        window.loadModel(newModel);

    }

}

)

.subscribe();