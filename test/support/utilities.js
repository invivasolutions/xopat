import 'cypress-wait-until';

export default {
    /**
     * Wait for image loading job finish
     * @param beforeLoadEvent if true, it waits also for 'loaded' event on the viewer
     */
    waitForViewer(beforeLoadEvent=true) {

        let window = undefined;
        let initialized = false;  //wait for load event
        if (beforeLoadEvent) {
            cy.window().then((win) => {
                window = win;
                window.VIEWER.addHandler('open', () => initialized = true);
            });
        } else {
            //give some space to the viewer so that image loader is not still without job
            cy.wait(300);
            cy.window().then((win) => {
                window = win;
                initialized = true;
            });
        }

        cy.waitUntil(() => {
            return initialized && window.VIEWER.imageLoader.jobsInProgress === 0
        }, {
            description: "Waiting for the images to load.",
            timeout: 30000,
            interval: 600,
            verbose: false
        });
    }
}