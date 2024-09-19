# To Do List
Just a quick list of missing functionality - intended more as notes than a definitive list of things to do

## Security
### CORS 
At the moment the CORS is wide open on both the anotations API and the WSI-Service interface. This is largely because the client browser generates the requests to these end points, rather than them being internal to docker, and I don't know how to do it "properly"

### Logins
#### mvp
At present this only passes on known variables to the underlying system - so `slides=xxxx` gets passed down to the wsi-server, but not say `token=xxxx`. This seems to be the simplest security option as we can then use existing nginx code to validate every request to both this and the underlying wsi-service.

#### final version
We'd need to integrate the same login system to the viewer, and have it pass down auth to the tile server too.

## GUI
Only 6 different annotation classes are shown in the plugin

Anotations are currently only per-session, and can only be downloaded to the client browser

Anotations are loaded only by button press - and it's all or nothing
- One alternative is to have an initial load with a list of available annotation with checkboxes, then to download checked anotations
- Another idea is to have buttons or links for each class of anotation with an option for confidence level filters

There are no next/previous slide links because the viewer layer doesn't link to the underlying database or  filesystem. If we passed it information on the other slides in a case we could implement such a button. 

## "backend"
The button that gets the anotations from the API does so by reading the url - but sometimes the slide ID isn't stored in the URL it's stored somewhere else that I can't find.
