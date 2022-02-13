// Set darkmode
document.getElementById('mode').addEventListener('click', () => {
	document.body.classList.toggle('dark');
	localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

// enforce local storage setting but also fallback to user-agent preferences
if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
	document.body.classList.add('dark');
}

const onToggleSidebarTitle = function(e) {

	const title = e.target;
	const relativeList = title.nextElementSibling;

	if(!relativeList.classList.contains('list-unstyled'))
		return;

	relativeList.classList.toggle('show');

	if(relativeList.classList.contains('show'))
		title.classList.add('docs-sidebar__title--open');
	else title.classList.remove('docs-sidebar__title--open');
}

const docsSidebarTitles = document.querySelectorAll('.docs-sidebar__title');
Array.from(docsSidebarTitles).forEach(docSidebarTitle => docSidebarTitle.addEventListener('click', onToggleSidebarTitle));