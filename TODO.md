# TODO - Remedine/Svelte_FullCalendar_Dexie_Scheduling

## High Priority
[x] Add PocketBase to the stack for auth and syncing
[x] Retool Auth utilizing Pocketbase
[] Add security for Dexie data (encrypt, clear on logout)

## Dexie & Data Layer
[x] Dexie Stores 
    [X] Client
    [X] User
    [X] Job
    [x] Options/Settings?
    [] Invoice
[x] Pocketbase for server sync

## Routes/Pages Views
[] Jobs
    [] Admin View
    [] Crew View
[] Calendar
    [] List View
        [] Calendar month view across top of mobile with list view of all jobs below determined by date clicked on
[] Crew Member Specific View
    [] Mobile (Calendar week across the top with list view of jobs assigned on the bottom)

## Client Requested Features
[] Email/push notification to crew member when assigned to a job.

## UI/UX & Styling

## Testing & Quality/Debugs
[] On Client View - restrict deleting clients if client has jobs (archive only)
[] Default job length is set to 30 minutes, then jumps to 4 hours on drag/drop event

## Nice to Have / Backlog
[] Darkmode
[] Calendar Now Indicator to see current time
[] business hours on calendar
[] Event Popovers(cards?)
[] List View on Calendar
[] Allow picking client from mobile device contact list
[] Use mobile gps location for address?
[] 

